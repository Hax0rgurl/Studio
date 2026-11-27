// Files selected in Slate stay in the browser. Saved references carry their JPEG frames.
window.SlateMedia=(()=>{
  const files=new Map();
  function remember(file){
    const key=crypto.randomUUID()+'/'+file.name;
    files.set(key,file);
    return key;
  }
  function pick(accept,multiple){
    return new Promise(resolve=>{
      const input=document.createElement('input');
      input.type='file';input.accept=accept;input.multiple=multiple;input.hidden=true;
      const finish=values=>{input.remove();resolve(values);};
      input.onchange=()=>finish(Array.from(input.files,remember));
      input.oncancel=()=>finish([]);
      document.body.append(input);input.click();
    });
  }
  function jpeg(source,width,height){
    if(!width||!height)throw Error('This frame has no readable dimensions.');
    const scale=Math.min(1,760/Math.max(width,height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',0.84);
  }
  function waitFor(media,event,start){
    return new Promise((resolve,reject)=>{
      const done=error=>{
        clearTimeout(timer);media.removeEventListener(event,ok);media.removeEventListener('error',fail);
        if(error)reject(error);else resolve();
      };
      const ok=()=>done(),fail=()=>done(Error('Could not decode this media file.'));
      const timer=setTimeout(fail,30000);
      media.addEventListener(event,ok);media.addEventListener('error',fail);
      try{start();}catch(error){done(error);}
    });
  }
  async function ingest(path,start,end){
    let file=files.get(path);
    if(!file){
      if(!/^(?:asset:\/\/localhost\/|https?:\/\/asset\.localhost\/)/.test(path))throw Error('Choose the source file again to extract new frames.');
      const response=await fetch(path);
      if(!response.ok)throw Error('The saved take could not be opened.');
      file=await response.blob();
    }
    const url=URL.createObjectURL(file);
    try{
      if(file.type.startsWith('image/')||/\.(png|jpe?g|webp|gif|heic|avif)$/i.test(path)){
        const img=new Image();img.src=url;await img.decode();
        return {kind:'image',frames:[jpeg(img,img.naturalWidth,img.naturalHeight)]};
      }
      const video=document.createElement('video');video.muted=true;video.preload='auto';video.playsInline=true;
      try{
        await waitFor(video,'loadeddata',()=>{video.src=url;});
        const from=Math.max(0,Number(start)||0),to=Math.min(video.duration,end==null?video.duration:Number(end));
        if(!Number.isFinite(to)||to<=from)throw Error('The clip has no readable frames in this range.');
        const frames=[];
        for(const fraction of [0.1,0.4,0.6,0.9]){
          const time=from+(to-from)*fraction;
          await waitFor(video,'seeked',()=>{video.currentTime=time;});
          frames.push(jpeg(video,video.videoWidth,video.videoHeight));
        }
        return {kind:'video',frames};
      }finally{video.removeAttribute('src');video.load();}
    }finally{URL.revokeObjectURL(url);}
  }
  async function analyzeAudio(path){
    const file=files.get(path);
    if(!file)throw Error('Choose the audio reference again.');
    const context=new AudioContext();
    try{
      const audio=await context.decodeAudioData(await file.arrayBuffer());
      const block=Math.max(1,Math.round(audio.sampleRate*0.05));
      const levels=[];let silentSamples=0,gap=0,longest=0;
      const channels=Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i));
      for(let i=0;i<audio.length;i+=block){
        const stop=Math.min(audio.length,i+block);let sum=0;
        for(const samples of channels)for(let k=i;k<stop;k++)sum+=samples[k]*samples[k];
        const db=10*Math.log10(Math.max(1e-12,sum/((stop-i)*channels.length)));
        levels.push(db);
        if(db < -50){silentSamples+=stop-i;gap+=stop-i;longest=Math.max(longest,gap);}else gap=0;
      }
      const active=levels.filter(db=>db>=-50).sort((a,b)=>a-b);
      const percentile=p=>active[Math.floor((active.length-1)*p)]||0;
      const energy=[0,1,2].map(third=>{
        const part=levels.slice(Math.floor(levels.length*third/3),Math.ceil(levels.length*(third+1)/3));
        return Math.round(10*Math.log10(Math.max(1e-12,part.reduce((n,db)=>n+10**(db/10),0)/(part.length||1))));
      });
      return {durationSec:+audio.duration.toFixed(2),sampleRate:audio.sampleRate,channels:audio.numberOfChannels,
        dynamicRangeDb:+(percentile(.95)-percentile(.05)).toFixed(1),silenceRatio:silentSamples/audio.length,
        longestSilenceSec:+(longest/audio.sampleRate).toFixed(2),energyDb:energy};
    }finally{files.delete(path);await context.close();}
  }
  return {pick,remember,ingest,analyzeAudio,release:path=>files.delete(path),reset:()=>files.clear()};
})();
