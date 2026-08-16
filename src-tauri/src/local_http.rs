use serde_json::Value;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

pub(crate) struct HttpResponse {
    pub(crate) status: u16,
    pub(crate) body: Vec<u8>,
}

impl HttpResponse {
    pub(crate) fn json(&self) -> Result<Value, String> {
        serde_json::from_slice(&self.body)
            .map_err(|error| format!("Local service returned invalid JSON: {error}"))
    }
}

/// A deliberately small HTTP/1.1 client restricted by its callers to fixed
/// loopback ports. Keeping this native avoids granting the webview arbitrary
/// network access or exposing Greenroom credentials to JavaScript.
pub(crate) fn request(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<&[u8]>,
    timeout: Duration,
) -> Result<HttpResponse, String> {
    if !matches!(method, "GET" | "POST") {
        return Err("Unsupported local HTTP method.".to_string());
    }
    if !path.starts_with('/') || path.contains(['\r', '\n']) {
        return Err("Invalid local HTTP path.".to_string());
    }
    for (name, value) in headers {
        if name.is_empty()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            || value.contains(['\r', '\n'])
        {
            return Err("Invalid local HTTP header.".to_string());
        }
    }

    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| format!("127.0.0.1:{port} is unavailable: {error}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| format!("Could not configure local connection: {error}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|error| format!("Could not configure local connection: {error}"))?;

    let body = body.unwrap_or_default();
    let mut request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n"
    );
    for (name, value) in headers {
        request.push_str(name);
        request.push_str(": ");
        request.push_str(value);
        request.push_str("\r\n");
    }
    if !body.is_empty() {
        request.push_str("Content-Type: application/json\r\n");
        request.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    request.push_str("\r\n");

    stream
        .write_all(request.as_bytes())
        .and_then(|_| stream.write_all(body))
        .map_err(|error| format!("Could not write to local service: {error}"))?;

    let mut raw = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                if raw.len() + count > MAX_RESPONSE_BYTES {
                    return Err("Local service response exceeded 4 MiB.".to_string());
                }
                raw.extend_from_slice(&buffer[..count]);
                // HTTP/1.1 servers are allowed to keep the socket alive after
                // the declared body is complete. Stop on framing instead of
                // burning the entire read timeout for every health check.
                if response_complete(&raw) {
                    break;
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                break
            }
            Err(error) => {
                return Err(format!("Could not read from local service: {error}"));
            }
        }
    }

    parse_response(&raw)
}

fn response_complete(raw: &[u8]) -> bool {
    let Some(split) = raw.windows(4).position(|window| window == b"\r\n\r\n") else {
        return false;
    };
    let Ok(headers) = std::str::from_utf8(&raw[..split]) else {
        return false;
    };
    let body = &raw[split + 4..];
    let mut chunked = false;
    let mut content_length = None;
    for line in headers.split("\r\n").skip(1) {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("content-length") {
            content_length = value.trim().parse::<usize>().ok();
        }
        if name.eq_ignore_ascii_case("transfer-encoding")
            && value
                .split(',')
                .any(|encoding| encoding.trim().eq_ignore_ascii_case("chunked"))
        {
            chunked = true;
        }
    }
    if chunked {
        return decode_chunked(body).is_ok();
    }
    content_length.is_some_and(|expected| body.len() >= expected)
}

fn parse_response(raw: &[u8]) -> Result<HttpResponse, String> {
    let split = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "Local service returned an incomplete HTTP response.".to_string())?;
    let header_bytes = &raw[..split];
    let body_bytes = &raw[split + 4..];
    let headers = std::str::from_utf8(header_bytes)
        .map_err(|_| "Local service returned invalid HTTP headers.".to_string())?;
    let mut lines = headers.split("\r\n");
    let status_line = lines
        .next()
        .ok_or_else(|| "Local service returned no HTTP status.".to_string())?;
    let status = status_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "Local service returned an invalid HTTP status.".to_string())?
        .parse::<u16>()
        .map_err(|_| "Local service returned an invalid HTTP status.".to_string())?;

    let is_chunked = lines.clone().any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("transfer-encoding")
                && value
                    .split(',')
                    .any(|encoding| encoding.trim().eq_ignore_ascii_case("chunked"))
        })
    });
    let content_length = lines.filter_map(|line| line.split_once(':')).find_map(
        |(name, value)| {
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        },
    );

    let body = if is_chunked {
        decode_chunked(body_bytes)?
    } else if let Some(expected) = content_length {
        if body_bytes.len() < expected {
            return Err("Local service returned an incomplete HTTP body.".to_string());
        }
        body_bytes[..expected].to_vec()
    } else {
        body_bytes.to_vec()
    };

    Ok(HttpResponse { status, body })
}

fn decode_chunked(mut input: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoded = Vec::new();
    loop {
        let line_end = input
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or_else(|| "Local service returned an incomplete chunk.".to_string())?;
        let size_text = std::str::from_utf8(&input[..line_end])
            .map_err(|_| "Local service returned an invalid chunk size.".to_string())?;
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or_default().trim(), 16)
            .map_err(|_| "Local service returned an invalid chunk size.".to_string())?;
        input = &input[line_end + 2..];
        if size == 0 {
            return Ok(decoded);
        }
        if input.len() < size + 2 || &input[size..size + 2] != b"\r\n" {
            return Err("Local service returned an incomplete chunk body.".to_string());
        }
        if decoded.len() + size > MAX_RESPONSE_BYTES {
            return Err("Local service response exceeded 4 MiB.".to_string());
        }
        decoded.extend_from_slice(&input[..size]);
        input = &input[size + 2..];
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_chunked, parse_response, response_complete};

    #[test]
    fn parses_content_length_response() {
        let response = parse_response(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}").unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body, b"{}");
    }

    #[test]
    fn decodes_chunked_response() {
        assert_eq!(
            decode_chunked(b"4\r\ntest\r\n3\r\n123\r\n0\r\n\r\n").unwrap(),
            b"test123"
        );
    }

    #[test]
    fn stops_when_a_keep_alive_response_body_is_complete() {
        let complete = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\n{}";
        assert!(response_complete(complete));
        assert!(!response_complete(
            b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: keep-alive\r\n\r\n{}"
        ));
        assert!(response_complete(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n"
        ));
    }
}
