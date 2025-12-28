/* assets/js/techbar.js — V1.0.0
   Techbar open/close behavior harmonization:
   - Close when clicking outside
   - Close on Escape
   Supports:
   - versionToggle + versionDetails (common modules)
   - miningVersionCta + miningVersionDetails (mining module)
*/
(function tvTechbar(){
  "use strict";

  function wire(toggleEl, panelEl){
    if (!toggleEl || !panelEl) return;
    if (toggleEl.dataset && toggleEl.dataset.techbarWired === "1") return;
    if (toggleEl.dataset) toggleEl.dataset.techbarWired = "1";

    function isOpen(){
      return !panelEl.classList.contains("is-hidden");
    }

    function setOpen(open){
      panelEl.classList.toggle("is-hidden", !open);
      panelEl.setAttribute("aria-hidden", open ? "false" : "true");
      try{
        toggleEl.setAttribute("aria-expanded", open ? "true" : "false");
      }catch(e){}
    }

    // Ensure closed state has correct aria
    if (!panelEl.hasAttribute("aria-hidden")){
      panelEl.setAttribute("aria-hidden", isOpen() ? "false" : "true");
    }

    // Close on outside click
    document.addEventListener("click", function(e){
      if (!isOpen()) return;
      var t = e.target;
      if (toggleEl.contains(t) || panelEl.contains(t)) return;
      setOpen(false);
    });

    // Close on Escape
    document.addEventListener("keydown", function(e){
      if (e.key !== "Escape") return;
      if (!isOpen()) return;
      setOpen(false);
    });
  }

  function init(){
    // Common modules
    wire(document.getElementById("versionToggle"), document.getElementById("versionDetails"));
    // Mining module
    wire(document.getElementById("miningVersionCta"), document.getElementById("miningVersionDetails"));
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  }else{
    init();
  }
})();
