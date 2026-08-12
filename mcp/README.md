# Agentic Movie Studio MCP

This zero-dependency MCP server lets an agent read a portable Agentic Movie Studio project without opening the desktop app. It exposes the screenplay breakdown, scenes, elements, bibles, shot list, prompt packs, draft shooting schedule, and cast Day Out of Days.

## Project files

Save a portable `.ams` project from Agentic Movie Studio and pass its absolute path as `projectPath` or through `AGENTIC_MOVIE_STUDIO_PROJECT`.

For compatibility, the reader also accepts `SCRIPTBREAK_PROJECT` and legacy `.studio` or `.scriptbreak` exports. It never writes to the project and does not open network connections.

```json
{
  "mcpServers": {
    "agentic-movie-studio": {
      "command": "node",
      "args": ["/absolute/path/to/Agentic Movie Studio/mcp/scriptbreak-mcp.mjs"],
      "env": {
        "AGENTIC_MOVIE_STUDIO_PROJECT": "/absolute/path/to/movie.ams"
      }
    }
  }
}
```

Node 18 or newer is required. There is no build step or dependency install.

## Tools

- `get_breakdown`
- `list_scenes`
- `get_scene`
- `list_elements`
- `get_character_bible`
- `get_location_bible`
- `get_shot_list`
- `list_generators`
- `export_prompt_pack`
- `get_schedule`
- `get_day_out_of_days`

Call `get_breakdown` first to see the project conventions and available generators.

## Two different MCP directions

This folder is the **outbound Agentic Movie Studio server**: other MCP clients can read a saved movie project. It is intentionally read-only.

The desktop app's planned **inbound connector host** is a different component. It will let the filmmaker add trusted stdio or Streamable HTTP MCP servers, inspect their declared tools, and explicitly bind a tool to a Studio capability such as still generation or video generation. A connector can advertise image, video, both, or neither; Studio keeps its image and video selections independent.

Inbound tools will not receive direct write access to the canonical project. Their results must return through the same schema validation, durable job receipt, billing confirmation, human review, canon, and TasteOS gates as a REST or local-engine provider. Credentials will remain in native secret storage or the stdio environment—not in `.ams` files or browser localStorage. The accepted architecture and honest implementation status are in [`../docs/decisions/0001-extensible-media-providers-and-mcp.md`](../docs/decisions/0001-extensible-media-providers-and-mcp.md).

## License

Apache-2.0. See the repository `LICENSE` and `NOTICE` files. The main README contains the acknowledgment and original-foundation link.
