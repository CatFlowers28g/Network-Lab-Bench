/* Platform adapter: the same app runs inside Claude (capabilities) or standalone (browser storage, your own API key). MIT License. */

"use strict";
const platform = {
  inClaude:false, db:null, user:null, sample:null, downloads:null, ready:false,
  async init(){
    if (typeof window!=="undefined" && window.claude && typeof window.claude.use==="function"){
      this.inClaude = true;
      const get = n => window.claude.use(n).then(x=>x, ()=>null);
      [this.db, this.user, this.sample, this.downloads] = await Promise.all(["db","user","sample","downloads"].map(get));
    }
    this.ready = true;
  },
  setting(k, v){ try{ if (v===undefined) return localStorage.getItem("labbench."+k) || ""; if (v===null) localStorage.removeItem("labbench."+k); else localStorage.setItem("labbench."+k, v); }catch(e){ return ""; } },
  canAsk(){ return !!this.sample || !!this.setting("apikey"); },
  async askJson(prompt, opts){
    opts = opts || {};
    if (this.sample) return this.sample.json(prompt, {signal:opts.signal, cache:false, onText:opts.onText});
    const key = this.setting("apikey");
    if (!key) throw {code:"no_key"};
    let res;
    try{
      res = await fetch("https://api.anthropic.com/v1/messages", {method:"POST", signal:opts.signal,
        headers:{"content-type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({model:this.setting("model")||"claude-sonnet-5-5", max_tokens:16000, messages:[{role:"user", content:prompt+"\n\nReply with only the JSON, no other text."}]})});
    }catch(e){ throw {code: e && e.name==="AbortError" ? "cancelled" : "network"}; }
    if (!res.ok){ const t = await res.text().catch(()=>""); throw {code: res.status===401 ? "bad_key" : res.status===429 ? "rate_limited" : "upstream_error", message:t.slice(0,200)}; }
    const data = await res.json();
    const text = (data.content||[]).map(b=>b.text||"").join("");
    if (opts.onText) opts.onText({text});
    const m = text.replace(/```json|```/g,"").match(/[\[{][\s\S]*[\]}]/);
    try{ return JSON.parse(m ? m[0] : text); }catch(e){ throw {code:"invalid_json", text}; }
  },
  async saveFile(filename, text, mime){
    if (this.downloads){ await this.downloads.save({filename, data:text}); return "saved"; }
    if (this.inClaude) throw {code:"unavailable"};
    const blob = new Blob([text], {type:mime||"text/plain"}); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 2000);
    return "saved";
  }
};
