$(function () {
  // Make hotSwap available globally
  window.hotSwap = function (page, pushState) {
    // Parse the page to handle special routes like workers/address
    var pageId = page;
    var params = {};

    // Check if this is a workers route with an address
    if (page && page.startsWith("workers/")) {
      var parts = page.split("/");
      pageId = "workers";
      if (parts[1]) {
        params.address = parts[1];
      }
    }

    // Update browser history
    if (pushState) {
      var url = page ? "/" + page : "/";
      history.pushState(null, null, url);
    }

    // Update active nav state
    $(".nav-item").removeClass("active");
    if (page === "" || page === "home") {
      $('a[href="/"]').addClass("active");
    } else if (pageId === "workers") {
      $('a[href="/workers"]').addClass("active");
    } else {
      $('a[href="/' + pageId + '"]').addClass("active");
    }

    // Close mobile menu if open
    $("#nav").removeClass("active").css("display", "");
    $("body").removeClass("menu-open");

    // Show loading state
    $("main").html(
      '<div class="loading" style="text-align: center; padding: 3rem;">' +
        '<i class="fas fa-spinner fa-spin" style="font-size: 3rem; color: var(--accent); margin-bottom: 1rem; display: block;"></i>' +
        '<p style="color: var(--text-secondary);">Loading...</p>' +
        "</div>"
    );

    // Build request parameters
    var requestParams = { id: pageId };

    // Add additional parameters if they exist
    if (params.address) {
      requestParams.address = params.address;
    }

    // Make the request
    $.get(
      "/get_page",
      requestParams,
      function (data) {
        $("main").html(data);

        // Close mobile menu if open (again, just to be sure)
        $("#nav").removeClass("active");
        $("body").removeClass("menu-open");

        // Reset page-specific initialization flags
        window.statsPageFullyInitialized = false;
        window.poolStatsInitialized = false;
        window.minerStatsScriptLoaded = false;

        // Page-specific initializations
        switch (pageId) {
          case "stats":
            if (typeof window.initStatsScripts === "function") {
              window.initStatsScripts();
            }
            break;

          case "payments":
            if (typeof window.initPaymentsScripts === "function") {
              window.initPaymentsScripts();
            }
            break;

          case "workers":
            if (typeof window.initWorkerScripts === "function") {
              window.initWorkerScripts();
            }
            break;

          case "":
          case "home":
            if (typeof initLiveStats === "function") {
              initLiveStats();
            }
            break;

          default:
            if (typeof initPageScripts === "function") {
              initPageScripts();
            }
            break;
        }

        // Re-apply language translations to new content
        const currentLang = localStorage.getItem("preferredLanguage") || "en";
        if (typeof setLanguage === "function") {
          setLanguage(currentLang);
        }

        // Debug log
        console.log("Page loaded:", pageId, "with params:", requestParams);
      },
      "html"
    ).fail(function (jqXHR, textStatus, errorThrown) {
      console.error("Page load error:", textStatus, errorThrown);
      console.error("Request was:", requestParams);
      $("main").html(
        '<div style="text-align: center; padding: 3rem; color: var(--text-secondary);">' +
          '<i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: var(--warning); margin-bottom: 1rem; display: block;"></i>' +
          '<h2 style="color: var(--text-primary); margin-bottom: 1rem;">Error Loading Page</h2>' +
          "<p>The page could not be loaded. Please try again.</p>" +
          '<button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: var(--accent); color: white; border: none; border-radius: 0.5rem; cursor: pointer;">Reload Page</button>' +
          "</div>"
      );
    });
  };

  // Global toggle menu function
  window.toggleMenu = function () {
    var nav = document.getElementById("nav");
    var body = document.body;

    if (!nav) {
      console.error("Nav not found!");
      return;
    }

    // Check current state
    var isActive = nav.classList.contains("active");

    if (isActive) {
      // Close menu
      nav.classList.remove("active");
      body.classList.remove("menu-open");
      // Reset display style on mobile
      if (window.innerWidth <= 768) {
        nav.style.display = "none";
      }
    } else {
      // Open menu
      nav.classList.add("active");
      body.classList.add("menu-open");
      // Force display on mobile
      if (window.innerWidth <= 768) {
        nav.style.display = "flex";
      }
    }
  };

  // Setup menu event handlers - ONLY ONCE
  function setupMenuHandlers() {
    // Remove any existing handlers first
    $(document).off("click.menuToggle");
    $(document).off("click.menuClose");
    $(document).off("click.navItem");

    // Handle menu toggle button clicks
    $(document).on("click.menuToggle", ".menu-toggle", function (e) {
      e.preventDefault();
      e.stopPropagation();
      window.toggleMenu();
      return false;
    });

    // Close menu when clicking outside
    $(document).on("click.menuClose", function (event) {
      if (
        !$(event.target).closest(".header").length &&
        !$(event.target).hasClass("menu-toggle") &&
        $("#nav").hasClass("active")
      ) {
        $("#nav").removeClass("active");
        $("body").removeClass("menu-open");
        if (window.innerWidth <= 768) {
          $("#nav").css("display", "none");
        }
      }
    });

    // Handle navigation clicks with delegation
    $(document).on("click.navItem", ".hot-swapper", function (event) {
      // Only handle left clicks
      if (event.which !== 1) return;

      event.preventDefault();
      var href = $(this).attr("href");
      var pageId = href === "/" ? "" : href.slice(1);
      window.hotSwap(pageId, true);
      return false;
    });
  }

  // Add critical mobile styles
  function addMobileStyles() {
    if (!document.getElementById("mobile-menu-styles")) {
      var style = document.createElement("style");
      style.id = "mobile-menu-styles";
      style.innerHTML = `
                @media (max-width: 768px) {
                    .menu-toggle {
                        display: block !important;
                    }
                    .nav {
                        display: none;
                    }
                    .nav.active {
                        display: flex !important;
                    }
                }
            `;
      document.head.appendChild(style);
    }
  }

  // Initialize EventSource for live stats
  function initializeEventSource() {
    if (window.statsSource) {
      window.statsSource.close();
    }

    window.statsSource = new EventSource("/api/live_stats");

    window.statsSource.addEventListener("message", function (e) {
      // Only process if not hidden
      if (!document.hidden) {
        try {
          const stats = JSON.parse(e.data);
          // Trigger custom event that pages can listen to
          $(document).trigger("statsUpdate", [stats]);
        } catch (err) {
          console.error("Error parsing stats:", err);
        }
      }
    });

    // Handle EventSource errors
    window.statsSource.onerror = function (e) {
      console.error("EventSource error:", e);
      // Attempt to reconnect after 5 seconds
      setTimeout(function () {
        if (
          window.statsSource &&
          window.statsSource.readyState === EventSource.CLOSED
        ) {
          console.log("Attempting to reconnect EventSource...");
          initializeEventSource();
        }
      }, 5000);
    };
  }

  // Handle browser back/forward buttons
  window.addEventListener("popstate", function (e) {
    var page = location.pathname.slice(1);
    window.hotSwap(page, false);
  });

  // Handle visibility change to pause/resume stats updates
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      // Page is hidden, close EventSource to save resources
      if (window.statsSource) {
        window.statsSource.close();
      }
    } else {
      // Page is visible again, reconnect
      initializeEventSource();
    }
  });

  // Add loading class to body during page transitions
  $(document)
    .ajaxStart(function () {
      $("body").addClass("loading-content");
    })
    .ajaxStop(function () {
      $("body").removeClass("loading-content");
    });

  // Initialize everything
  addMobileStyles();
  setupMenuHandlers();
  initializeEventSource();

  // Load initial page based on URL
  var initialPage = location.pathname.slice(1);
  if (initialPage && initialPage !== "") {
    window.hotSwap(initialPage, false);
  }
});

// Helper functions for stats formatting (globally available)
function getReadableHashRateString(hashrate) {
  hashrate = parseFloat(hashrate) * 1000000;
  if (isNaN(hashrate) || hashrate < 1000000) {
    return "0 H/s";
  }
  var byteUnits = [
    " H/s",
    " KH/s",
    " MH/s",
    " GH/s",
    " TH/s",
    " PH/s",
    " EH/s",
    " ZH/s",
    " YH/s",
  ];
  var i = Math.floor(Math.log(hashrate / 1000) / Math.log(1000) - 1);
  hashrate = hashrate / 1000 / Math.pow(1000, i + 1);
  return hashrate.toFixed(2) + byteUnits[i];
}

function getReadableDifficultyString(difficulty) {
  if (difficulty >= 1e24) return (difficulty / 1e24).toFixed(2) + " Y";
  if (difficulty >= 1e21) return (difficulty / 1e21).toFixed(2) + " Z";
  if (difficulty >= 1e18) return (difficulty / 1e18).toFixed(2) + " E";
  if (difficulty >= 1e15) return (difficulty / 1e15).toFixed(2) + " P";
  if (difficulty >= 1e12) return (difficulty / 1e12).toFixed(2) + " T";
  if (difficulty >= 1e9) return (difficulty / 1e9).toFixed(2) + " G";
  if (difficulty >= 1e6) return (difficulty / 1e6).toFixed(2) + " M";
  if (difficulty >= 1e3) return (difficulty / 1e3).toFixed(2) + " k";
  return difficulty.toFixed(2);
}

function getReadableSharesString(shares) {
  shares = parseFloat(shares);
  if (isNaN(shares) || shares < 1) {
    return "0";
  }

  // Define units and thresholds
  var units = [
    { value: 1e12, suffix: " T" }, // Trillion
    { value: 1e9, suffix: " B" }, // Billion
    { value: 1e6, suffix: " M" }, // Million
    { value: 1e3, suffix: " K" }, // Thousand
  ];

  // Find the appropriate unit
  for (var i = 0; i < units.length; i++) {
    if (shares >= units[i].value) {
      var value = shares / units[i].value;
      // Use 2 decimal places for values under 100, 1 for values under 1000, 0 for larger
      var decimals = value < 10 ? 2 : value < 100 ? 1 : 0;
      return value.toFixed(decimals) + units[i].suffix;
    }
  }

  // For small numbers, just return the rounded value
  return Math.round(shares).toString();
}

function capitalizeFirstLetter(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Function to handle direct worker lookups
function lookupWorker(address) {
  if (!address) {
    alert("Please enter a wallet address");
    return;
  }

  // Navigate to the workers page with the address
  var page = "workers/" + address;

  // Use the global hotSwap function
  if (window.hotSwap) {
    window.hotSwap(page, true);
  } else {
    // Fallback to direct navigation
    window.location.href = "/workers/" + address;
  }
}

// Pool Message Functions
(function () {
  const colorIcons = {
    blue: "fa-info-circle",
    green: "fa-check-circle",
    yellow: "fa-exclamation-triangle",
    red: "fa-exclamation-circle",
  };

  let currentMessageId = null;

  function loadPoolMessage() {
    // Check if user has dismissed the message
    const dismissed = sessionStorage.getItem("poolMessageDismissed");
    if (dismissed === "true") {
      return;
    }

    fetch("/api/pool_message")
      .then((response) => response.json())
      .then((data) => {
        if (data.result && data.result.enabled && data.result.text) {
          // Check if message has changed
          if (
            currentMessageId !== data.result.id ||
            currentMessageId === null
          ) {
            currentMessageId = data.result.id;
            displayPoolMessage(data.result);
          }
        } else {
          // No message or message disabled - hide banner if showing
          if (currentMessageId !== null) {
            currentMessageId = null;
            const banner = document.getElementById("poolMessageBanner");
            if (banner && banner.style.display !== "none") {
              banner.style.animation = "slideUp 0.3s ease-out";
              setTimeout(() => {
                banner.style.display = "none";
                banner.style.animation = "";
                document.body.classList.remove("has-pool-message");
              }, 300);
            }
          }
        }
      })
      .catch((err) => {
        console.error("Failed to load pool message:", err);
      });
  }

  function displayPoolMessage(message) {
    const banner = document.getElementById("poolMessageBanner");
    const textElement = document.getElementById("poolMessageText");
    const iconElement = banner
      ? banner.querySelector(".pool-message-icon")
      : null;

    if (!banner || !textElement || !iconElement) return;

    // Set text
    textElement.textContent = message.text;

    // Set color class
    const color = message.color || "blue";
    banner.className = "pool-message-banner message-" + color;

    // Set icon
    iconElement.className = "fas " + colorIcons[color] + " pool-message-icon";

    // Show banner
    banner.style.display = "block";

    // Add class to body for layout adjustment
    document.body.classList.add("has-pool-message");

    // Always enable scrolling animation
    setTimeout(() => {
      textElement.classList.add("scrolling");
    }, 100);
  }

  window.closePoolMessage = function () {
    const banner = document.getElementById("poolMessageBanner");
    if (banner) {
      banner.style.animation = "slideUp 0.3s ease-out";
      setTimeout(() => {
        banner.style.display = "none";
        banner.style.animation = "";
        document.body.classList.remove("has-pool-message");
      }, 300);

      // Remember dismissal for this session
      sessionStorage.setItem("poolMessageDismissed", "true");
    }
  };

  // Load message on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadPoolMessage);
  } else {
    loadPoolMessage();
  }

  // Auto-refresh pool message every 2 minutes
  setInterval(loadPoolMessage, 120000);

  // Reload when tab becomes visible (user switches back to the page)
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      // Clear dismissed flag when tab becomes visible again
      // This allows users to see new messages
      sessionStorage.removeItem("poolMessageDismissed");
      loadPoolMessage();
    }
  });
})();
