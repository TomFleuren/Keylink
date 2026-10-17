(function () {
  document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.addEventListener("click", function () {
      var selector = button.getAttribute("data-copy");
      var node = selector ? document.querySelector(selector) : null;
      var text = node ? node.textContent || "" : "";
      if (!text) return;
      navigator.clipboard.writeText(text.trim()).then(function () {
        var previous = button.textContent;
        button.textContent = "Copied";
        window.setTimeout(function () {
          button.textContent = previous;
        }, 1400);
      });
    });
  });
})();
