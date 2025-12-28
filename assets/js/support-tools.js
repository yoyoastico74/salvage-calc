/* assets/js/support-tools.js — V1.0.0
   Techbar Support Tools (Template bug + Infos debug)
   - Single shared script used across modules
   - Clipboard with visible feedback + manual fallback
*/
(function tvSupportTools(){
  "use strict";

  function $(sel, root){ return (root || document).querySelector(sel); }
  function byId(id){ return document.getElementById(id); }

  function getVersionText(){
    // Try common version sources across modules
    var v =
      (byId("versionMainText") && byId("versionMainText").textContent) ||
      (byId("miningVersionClosedLabel") && byId("miningVersionClosedLabel").textContent) ||
      ($(".version-left") && $(".version-left").textContent) ||
      document.title ||
      "";
    return (v || "").replace(/\s+/g, " ").trim();
  }

  function nowLocal(){
    try { return new Date().toLocaleString(); } catch(e) { return String(new Date()); }
  }

  function fallbackCopy(text){
    try{
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.left = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch(e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }catch(e){
      return false;
    }
  }

  async function copyText(text){
    if (!text) return false;
    try{
      if (navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(text);
        return true;
      }
    }catch(e){}
    return fallbackCopy(text);
  }

  function flash(btn, ok){
    if (!btn) return;
    var old = btn.textContent;
    btn.textContent = ok ? "Copié ✓" : "Échec";
    btn.disabled = true;
    setTimeout(function(){
      btn.textContent = old;
      btn.disabled = false;
    }, 1200);
  }

  function manualPrompt(text){
    try{
      window.prompt("Copie manuelle (Ctrl+C / Cmd+C) :", text);
    }catch(e){}
  }

  function buildBugTemplate(){
    var v = getVersionText();
    var url = location.href;
    return [
      "Titre: [" + (v || "Module") + "] Résumé du problème",
      "",
      "1) Type: Bug / Suggestion / Question",
      "2) Module + Version: " + (v || "—"),
      "3) Description (claire et courte):",
      "4) Étapes pour reproduire:",
      "   - 1)",
      "   - 2)",
      "   - 3)",
      "5) Résultat attendu:",
      "6) Résultat obtenu:",
      "7) Plateforme: PC/Mobile + Navigateur",
      "8) Preuves: screenshot/vidéo si possible",
      "",
      "Infos auto:",
      "- Page: " + url,
      "- Date/heure: " + nowLocal()
    ].join("\n");
  }

  function buildDebugInfo(){
    var v = getVersionText();
    var lines = [
      "Module + Version: " + (v || "—"),
      "Page: " + location.href,
      "Date/heure: " + nowLocal(),
      "UserAgent: " + (navigator.userAgent || ""),
      "Platform: " + (navigator.platform || ""),
      "Screen: " + (window.screen ? (screen.width + "x" + screen.height) : "—")
    ];
    return lines.join("\n");
  }

  function wire(){
    var btnTpl = byId("copyBugTemplateBtn");
    var btnDbg = byId("copyDebugInfoBtn");

    if (btnTpl){
      btnTpl.addEventListener("click", async function(e){
        e.preventDefault(); e.stopPropagation();
        var text = buildBugTemplate();
        var ok = await copyText(text);
        flash(btnTpl, ok);
        if (!ok) manualPrompt(text);
      });
    }

    if (btnDbg){
      btnDbg.addEventListener("click", async function(e){
        e.preventDefault(); e.stopPropagation();
        var text = buildDebugInfo();
        var ok = await copyText(text);
        flash(btnDbg, ok);
        if (!ok) manualPrompt(text);
      });
    }
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", wire);
  }else{
    wire();
  }
})();
