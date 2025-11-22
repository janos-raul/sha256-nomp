/**
 * SHA256-NOMP Admin Panel
 * Modern admin interface with enhanced security
 */

(function () {
  "use strict";

  // Secure cookie management with additional security features
  const SecureCookies = {
    getItem: function (key) {
      const value = document.cookie.match(
        "(^|;)\\s*" + key + "\\s*=\\s*([^;]+)"
      );
      return value ? decodeURIComponent(value.pop()) : null;
    },

    setItem: function (key, value, options = {}) {
      if (
        !key ||
        /^(?:expires|max-age|path|domain|secure|samesite)$/i.test(key)
      ) {
        console.error("Invalid cookie key");
        return false;
      }

      const defaults = {
        path: "/",
        secure: window.location.protocol === "https:",
        sameSite: "Strict",
      };

      const settings = { ...defaults, ...options };
      let cookieString =
        encodeURIComponent(key) + "=" + encodeURIComponent(value);

      if (settings.maxAge) {
        cookieString += "; max-age=" + settings.maxAge;
      } else if (settings.expires) {
        cookieString +=
          "; expires=" +
          (settings.expires instanceof Date
            ? settings.expires.toUTCString()
            : settings.expires);
      }

      if (settings.path) cookieString += "; path=" + settings.path;
      if (settings.domain) cookieString += "; domain=" + settings.domain;
      if (settings.secure) cookieString += "; secure";
      if (settings.sameSite) cookieString += "; samesite=" + settings.sameSite;

      document.cookie = cookieString;
      return true;
    },

    removeItem: function (key, path = "/") {
      if (!this.hasItem(key)) return false;
      document.cookie =
        encodeURIComponent(key) +
        "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=" +
        path;
      return true;
    },

    hasItem: function (key) {
      return new RegExp("(?:^|;\\s*)" + encodeURIComponent(key) + "\\s*=").test(
        document.cookie
      );
    },
  };

  // Admin state management
  const AdminState = {
    sessionId: null,
    token: null,
    isAuthenticated: false,
    sessionTimeout: null,
    lastActivity: Date.now(),
    failedAttempts: 0,
    lockoutUntil: null,

    // Session timeout: 30 minutes of inactivity
    SESSION_TIMEOUT: 30 * 60 * 1000,

    init: function () {
      this.sessionId = SecureCookies.getItem("adminSessionId");
      this.token = SecureCookies.getItem("adminToken");
      this.loadFailedAttempts();
      this.startActivityMonitor();
      this.checkLockout();
    },

    loadFailedAttempts: function () {
      const attempts = localStorage.getItem("adminFailedAttempts");
      const lockout = localStorage.getItem("adminLockoutUntil");

      if (attempts) {
        this.failedAttempts = parseInt(attempts);
      }
      if (lockout) {
        this.lockoutUntil = parseInt(lockout);
      }
    },

    saveFailedAttempts: function () {
      localStorage.setItem(
        "adminFailedAttempts",
        this.failedAttempts.toString()
      );
      if (this.lockoutUntil) {
        localStorage.setItem("adminLockoutUntil", this.lockoutUntil.toString());
      }
    },

    clearFailedAttempts: function () {
      this.failedAttempts = 0;
      this.lockoutUntil = null;
      localStorage.removeItem("adminFailedAttempts");
      localStorage.removeItem("adminLockoutUntil");
    },

    recordFailedAttempt: function () {
      this.failedAttempts++;

      // Save the attempt count
      this.saveFailedAttempts();

      // Only trigger lockout after 3 or more failed attempts
      if (this.failedAttempts >= 3) {
        // Progressive delay starting from 3rd attempt
        const delays = [
          5 * 60 * 1000, // 3 attempts: 5 minutes
          10 * 60 * 1000, // 4 attempts: 10 minutes
          30 * 60 * 1000, // 5 attempts: 30 minutes
          60 * 60 * 1000, // 6 attempts: 1 hour
          120 * 60 * 1000, // 7 attempts: 2 hours
          240 * 60 * 1000, // 8+ attempts: 4 hours
        ];

        const delayIndex = Math.min(this.failedAttempts - 3, delays.length - 1);
        const delay = delays[delayIndex];

        this.lockoutUntil = Date.now() + delay;
        this.saveFailedAttempts();

        return delay;
      }

      // No lockout yet, just tracking attempts
      return 0;
    },

    checkLockout: function () {
      if (this.lockoutUntil && Date.now() < this.lockoutUntil) {
        const remaining = this.lockoutUntil - Date.now();
        const minutes = Math.ceil(remaining / 60000);
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;

        let timeString;
        if (hours > 0) {
          timeString = hours + "h " + mins + "m";
        } else {
          timeString = minutes + " minute" + (minutes === 1 ? "" : "s");
        }

        AdminUI.showError(
          "Too many failed attempts. Please wait " +
            timeString +
            " before trying again."
        );
        AdminUI.disableLoginForm(remaining);
        return true;
      } else if (this.lockoutUntil && Date.now() >= this.lockoutUntil) {
        // Lockout expired, clear it
        this.clearFailedAttempts();
      }
      return false;
    },

    isLockedOut: function () {
      return this.lockoutUntil && Date.now() < this.lockoutUntil;
    },

    setSession: function (sessionId, token, remember = false) {
      this.sessionId = sessionId;
      this.token = token;
      this.lastActivity = Date.now();

      if (remember) {
        // Keep logged in for 7 days
        SecureCookies.setItem("adminSessionId", sessionId, {
          maxAge: 7 * 24 * 60 * 60,
        });
        SecureCookies.setItem("adminToken", token, {
          maxAge: 7 * 24 * 60 * 60,
        });
      } else {
        // Session cookie (expires when browser closes)
        SecureCookies.setItem("adminSessionId", sessionId);
        SecureCookies.setItem("adminToken", token);
      }
    },

    clearSession: function () {
      this.sessionId = null;
      this.token = null;
      this.isAuthenticated = false;
      SecureCookies.removeItem("adminSessionId");
      SecureCookies.removeItem("adminToken");
      if (this.sessionTimeout) {
        clearTimeout(this.sessionTimeout);
      }
    },

    updateActivity: function () {
      this.lastActivity = Date.now();
      this.resetSessionTimeout();
    },

    startActivityMonitor: function () {
      const events = ["mousedown", "keydown", "scroll", "touchstart"];
      events.forEach((event) => {
        document.addEventListener(event, () => this.updateActivity());
      });
      this.resetSessionTimeout();
    },

    resetSessionTimeout: function () {
      if (this.sessionTimeout) {
        clearTimeout(this.sessionTimeout);
      }

      if (this.isAuthenticated) {
        this.sessionTimeout = setTimeout(() => {
          this.handleSessionTimeout();
        }, this.SESSION_TIMEOUT);
      }
    },

    handleSessionTimeout: function () {
      AdminUI.showError(
        "Session expired due to inactivity. Please log in again."
      );
      this.clearSession();
      AdminUI.showLogin();
    },
  };

  // UI Management
  const AdminUI = {
    elements: {
      loginForm: null,
      dashboard: null,
      loginError: null,
      loginErrorText: null,
      poolsList: null,
    },

    init: function () {
      this.cacheElements();
      this.attachEventListeners();
    },

    cacheElements: function () {
      this.elements.loginForm = document.getElementById("loginForm");
      this.elements.dashboard = document.getElementById("adminDashboard");
      this.elements.loginError = document.getElementById("loginError");
      this.elements.loginErrorText = document.getElementById("loginErrorText");
      this.elements.poolsList = document.getElementById("poolsList");
    },

    attachEventListeners: function () {
      // Login form submission
      const loginForm = document.getElementById("adminLoginForm");
      if (loginForm) {
        loginForm.addEventListener("submit", (e) => {
          e.preventDefault();
          this.handleLogin();
        });
      }

      // Logout button
      const logoutBtn = document.getElementById("logoutBtn");
      if (logoutBtn) {
        logoutBtn.addEventListener("click", () => this.handleLogout());
      }

      // Admin navigation
      document.querySelectorAll(".admin-nav-link").forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const section = link.getAttribute("data-section");
          this.switchSection(section);
        });
      });

      // Clear error on input
      const passwordInput = document.getElementById("adminPassword");
      if (passwordInput) {
        passwordInput.addEventListener("input", () => this.hideError());
      }
    },

    handleLogin: async function () {
      // Check if locked out
      if (AdminState.isLockedOut()) {
        AdminState.checkLockout();
        return;
      }

      const passwordInput = document.getElementById("adminPassword");
      const rememberCheckbox = document.getElementById("rememberMe");

      const password = passwordInput ? passwordInput.value.trim() : "";
      const remember = rememberCheckbox ? rememberCheckbox.checked : false;

      if (!password) {
        this.showError("Please enter a password");
        return;
      }

      try {
        // Call login endpoint to get session token
        const response = await AdminAPI.login(password, remember);

        if (response && response.sessionId && response.token) {
          // Save session credentials
          AdminState.setSession(response.sessionId, response.token, remember);
          AdminState.clearFailedAttempts();

          // Clear password input
          if (passwordInput) passwordInput.value = "";

          // Show dashboard
          this.showDashboard();

          // Load initial data
          await AdminAPI.loadOverview();
        } else {
          this.showError("Login failed: Invalid response from server");
        }
      } catch (error) {
        if (!error.message || error.message === "Unauthorized") {
          // Error already shown by AdminAPI.login
        } else {
          this.showError("Login failed: " + error.message);
        }
      }
    },

    handleLogout: async function () {
      if (confirm("Are you sure you want to logout?")) {
        try {
          // Notify server to destroy session
          await AdminAPI.logout();
        } catch (error) {
          console.error("Logout error:", error);
        }

        AdminState.clearSession();
        this.showLogin();
        this.showMessage("Logged out successfully", "success");
      }
    },

    showLogin: function () {
      if (this.elements.dashboard)
        this.elements.dashboard.classList.remove("active");
      if (this.elements.loginForm)
        this.elements.loginForm.style.display = "block";

      // Clear password input
      const passwordInput = document.getElementById("adminPassword");
      if (passwordInput) passwordInput.value = "";

      this.hideError();
    },

    showDashboard: function () {
      if (this.elements.loginForm)
        this.elements.loginForm.style.display = "none";
      if (this.elements.dashboard)
        this.elements.dashboard.classList.add("active");

      AdminState.isAuthenticated = true;
      AdminState.updateActivity();
    },

    showError: function (message) {
      if (this.elements.loginErrorText) {
        this.elements.loginErrorText.textContent = message;
      }
      if (this.elements.loginError) {
        this.elements.loginError.classList.add("show");
      }
    },

    hideError: function () {
      if (this.elements.loginError) {
        this.elements.loginError.classList.remove("show");
      }
    },

    disableLoginForm: function (remaining) {
      const passwordInput = document.getElementById("adminPassword");
      const loginButton = document.querySelector(
        '#adminLoginForm button[type="submit"]'
      );
      const rememberCheckbox = document.getElementById("rememberMe");

      if (passwordInput) passwordInput.disabled = true;
      if (loginButton) {
        loginButton.disabled = true;
        loginButton.style.opacity = "0.5";
        loginButton.style.cursor = "not-allowed";
      }
      if (rememberCheckbox) rememberCheckbox.disabled = true;

      // Optional: Add countdown timer
      if (remaining && loginButton) {
        const updateTimer = () => {
          const timeLeft = AdminState.lockoutUntil - Date.now();
          if (timeLeft <= 0) {
            this.enableLoginForm();
            AdminState.clearFailedAttempts();
            this.hideError();
            return;
          }

          const minutes = Math.ceil(timeLeft / 60000);
          const hours = Math.floor(minutes / 60);
          const mins = minutes % 60;

          let timeString;
          if (hours > 0) {
            timeString = hours + "h " + mins + "m";
          } else {
            timeString = minutes + " minute" + (minutes === 1 ? "" : "s");
          }

          loginButton.textContent = "Locked (" + timeString + ")";

          setTimeout(updateTimer, 1000);
        };

        updateTimer();
      }
    },

    enableLoginForm: function () {
      const passwordInput = document.getElementById("adminPassword");
      const loginButton = document.querySelector(
        '#adminLoginForm button[type="submit"]'
      );
      const rememberCheckbox = document.getElementById("rememberMe");

      if (passwordInput) passwordInput.disabled = false;
      if (loginButton) {
        loginButton.disabled = false;
        loginButton.style.opacity = "1";
        loginButton.style.cursor = "pointer";
        loginButton.textContent = "Login";
      }
      if (rememberCheckbox) rememberCheckbox.disabled = false;
    },

    showMessage: function (message, type = "success") {
      // You can implement a toast notification system here
      console.log(`[${type.toUpperCase()}] ${message}`);
    },

    switchSection: function (sectionName) {
      // Update nav links
      document.querySelectorAll(".admin-nav-link").forEach((link) => {
        link.classList.remove("active");
        if (link.getAttribute("data-section") === sectionName) {
          link.classList.add("active");
        }
      });

      // Update sections
      document.querySelectorAll(".admin-section").forEach((section) => {
        section.classList.remove("active");
      });

      const activeSection = document.getElementById("section-" + sectionName);
      if (activeSection) {
        activeSection.classList.add("active");

        // Load section-specific data
        this.loadSectionData(sectionName);
      }
    },

    loadSectionData: function (sectionName) {
      switch (sectionName) {
        case "overview":
          AdminAPI.loadOverview();
          break;
        case "pools":
          AdminAPI.loadPools();
          break;
        case "logs":
          AdminAPI.loadLogs();
          break;
        case "settings":
          AdminSettings.loadSettings();
          break;
        case "pool-message":
          window.PoolMessage.loadPoolMessage();
          break;
      }
    },

    renderPools: function (pools) {
      if (!this.elements.poolsList) return;

      if (!pools || Object.keys(pools).length === 0) {
        this.elements.poolsList.innerHTML =
          '<p style="color: var(--text-secondary);">No pools configured</p>';
        return;
      }

      const poolCards = Object.entries(pools)
        .map(([poolName, poolData]) => {
          const config = poolData.config || {};
          const stats = poolData.stats;
          const ports = config.ports || {};
          const portCount = Object.keys(ports).length;

          // Handle coin name - it might be a string or an object
          let coinName = poolName.toUpperCase(); // Default to pool name
          if (config.coin) {
            if (typeof config.coin === "string") {
              coinName = config.coin.replace(".json", "").toUpperCase();
            } else if (typeof config.coin === "object") {
              // If coin is loaded as an object with coin definitions
              coinName =
                config.coin.name ||
                config.coin.symbol ||
                poolName.toUpperCase();
            }
          }

          // Status determination
          const isEnabled = config.enabled !== false;
          const hasMiners = stats && stats.minerCount > 0;
          const statusColor = isEnabled
            ? hasMiners
              ? "var(--success)"
              : "var(--warning)"
            : "var(--text-muted)";
          const statusIcon = isEnabled
            ? hasMiners
              ? "fa-check-circle"
              : "fa-clock"
            : "fa-times-circle";
          const statusText = isEnabled
            ? hasMiners
              ? "Active"
              : "Idle"
            : "Disabled";

          // Format hashrate
          const formatHashrate = (hr) => {
            if (!hr || hr === 0) return "0 H/s";
            const units = [
              "H/s",
              "KH/s",
              "MH/s",
              "GH/s",
              "TH/s",
              "PH/s",
              "EH/s",
            ];
            let unitIndex = 0;
            let rate = hr;
            while (rate >= 1000 && unitIndex < units.length - 1) {
              rate /= 1000;
              unitIndex++;
            }
            return rate.toFixed(2) + " " + units[unitIndex];
          };

          // Format difficulty
          const formatDifficulty = (diff) => {
            if (!diff || diff === 0) return "0";
            const units = ["", "K", "M", "G", "T", "P", "E"];
            let unitIndex = 0;
            let value = diff;
            while (value >= 1000 && unitIndex < units.length - 1) {
              value /= 1000;
              unitIndex++;
            }
            return value.toFixed(2) + units[unitIndex];
          };

          return `
                    <div class="pool-card" data-pool="${this.escapeHtml(
                      poolName
                    )}">
                        <div class="pool-card-header">
                            <div class="pool-title-section">
                                <h3>
                                    <i class="fas fa-cube"></i>
                                    ${this.escapeHtml(poolName)}
                                </h3>
                                <span class="pool-coin-badge">${this.escapeHtml(
                                  coinName
                                )}</span>
                            </div>
                            <div class="pool-status" style="color: ${statusColor};">
                                <i class="fas ${statusIcon}"></i>
                                ${statusText}
                            </div>
                        </div>

                        ${
                          stats
                            ? `
                        <div class="pool-stats-grid">
                            <div class="stat-box">
                                <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: var(--accent);">
                                    <i class="fas fa-tachometer-alt"></i>
                                </div>
                                <div class="stat-details">
                                    <div class="stat-label">Pool Hashrate</div>
                                    <div class="stat-value">${formatHashrate(
                                      stats.hashrate
                                    )}</div>
                                </div>
                            </div>
                            <div class="stat-box">
                                <div class="stat-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--success);">
                                    <i class="fas fa-users"></i>
                                </div>
                                <div class="stat-details">
                                    <div class="stat-label">Miners</div>
                                    <div class="stat-value">${stats.minerCount}
                                        ${
                                          stats.soloMinerCount > 0
                                            ? `<span style="font-size: 0.75rem; color: var(--text-muted);"> (${stats.soloMinerCount} solo)</span>`
                                            : ""
                                        }
                                    </div>
                                </div>
                            </div>
                            <div class="stat-box">
                                <div class="stat-icon" style="background: rgba(168, 85, 247, 0.1); color: #a855f7;">
                                    <i class="fas fa-network-wired"></i>
                                </div>
                                <div class="stat-details">
                                    <div class="stat-label">Network Hashrate</div>
                                    <div class="stat-value">${
                                      stats.networkHashString ||
                                      formatHashrate(stats.networkHashrate)
                                    }</div>
                                </div>
                            </div>
                            <div class="stat-box">
                                <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: var(--warning);">
                                    <i class="fas fa-cube"></i>
                                </div>
                                <div class="stat-details">
                                    <div class="stat-label">Network Difficulty</div>
                                    <div class="stat-value">${formatDifficulty(
                                      stats.networkDiff
                                    )}</div>
                                </div>
                            </div>
                        </div>
                        `
                            : '<p style="color: var(--text-muted); font-size: 0.9rem; margin: 1rem 0;">No live stats available</p>'
                        }

                        <div class="pool-info">
                            <div class="pool-info-item">
                                <span class="pool-info-label"><i class="fas fa-server"></i> Ports</span>
                                <span class="pool-info-value">${portCount} configured</span>
                            </div>
                            <div class="pool-info-item">
                                <span class="pool-info-label"><i class="fas fa-percentage"></i> Pool Fee</span>
                                <span class="pool-info-value">${
                                  config.paymentProcessing?.poolFee || 0
                                }%</span>
                            </div>
                            <div class="pool-info-item">
                                <span class="pool-info-label"><i class="fas fa-coins"></i> Min Payment</span>
                                <span class="pool-info-value">${
                                  config.paymentProcessing?.minimumPayment ||
                                  "N/A"
                                }</span>
                            </div>
                            <div class="pool-info-item">
                                <span class="pool-info-label"><i class="fas fa-shield-alt"></i> Solo Mining</span>
                                <span class="pool-info-value">${
                                  config.paymentProcessing?.soloMining
                                    ? '<span style="color: var(--success);"><i class="fas fa-check"></i> Enabled</span>'
                                    : '<span style="color: var(--text-muted);"><i class="fas fa-times"></i> Disabled</span>'
                                }</span>
                            </div>
                        </div>

                        <button class="btn-view-details" data-pool="${this.escapeHtml(
                          poolName
                        )}">
                            <i class="fas fa-info-circle"></i> View Details
                        </button>
                    </div>
                `;
        })
        .join("");

      this.elements.poolsList.innerHTML = poolCards;

      // Attach click handlers for detail buttons
      document.querySelectorAll(".btn-view-details").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const poolName = e.currentTarget.getAttribute("data-pool");
          this.showPoolDetails(poolName, pools[poolName]);
        });
      });
    },

    showPoolDetails: function (poolName, poolData) {
      // Create and show pool details modal
      const config = poolData.config || {};
      const stats = poolData.stats;
      const ports = config.ports || {};

      const formatHashrate = (hr) => {
        if (!hr || hr === 0) return "0 H/s";
        const units = ["H/s", "KH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s"];
        let unitIndex = 0;
        let rate = hr;
        while (rate >= 1000 && unitIndex < units.length - 1) {
          rate /= 1000;
          unitIndex++;
        }
        return rate.toFixed(2) + " " + units[unitIndex];
      };

      const formatDifficulty = (diff) => {
        if (!diff || diff === 0) return "0";
        const units = ["", "K", "M", "G", "T", "P", "E"];
        let unitIndex = 0;
        let value = diff;
        while (value >= 1000 && unitIndex < units.length - 1) {
          value /= 1000;
          unitIndex++;
        }
        return value.toFixed(2) + units[unitIndex];
      };

      const portsHtml = Object.entries(ports)
        .map(([port, portConfig]) => {
          return `
                    <div class="port-item">
                        <div class="port-number">:${port}</div>
                        <div class="port-details">
                            <div><strong>Initial Diff:</strong> ${portConfig.diff.toLocaleString()}</div>
                            <div><strong>VarDiff:</strong> ${
                              portConfig.varDiff
                                ? `${portConfig.varDiff.minDiff.toLocaleString()} - ${portConfig.varDiff.maxDiff.toLocaleString()}`
                                : "Disabled"
                            }</div>
                            <div><strong>Solo:</strong> ${
                              portConfig.soloMining
                                ? '<span style="color: var(--success);">Yes</span>'
                                : '<span style="color: var(--text-muted);">No</span>'
                            }</div>
                        </div>
                    </div>
                `;
        })
        .join("");

      const modalHtml = `
                <div class="pool-modal-overlay" id="poolModal">
                    <div class="pool-modal">
                        <div class="pool-modal-header">
                            <h2><i class="fas fa-cube"></i> ${this.escapeHtml(
                              poolName
                            )}</h2>
                            <button class="modal-close" onclick="document.getElementById('poolModal').remove()">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="pool-modal-content">
                            <div class="detail-section">
                                <h3><i class="fas fa-info-circle"></i> General Information</h3>
                                <div class="detail-grid">
                                    <div><strong>Coin:</strong> ${this.escapeHtml(
                                      typeof config.coin === "string"
                                        ? config.coin.replace(".json", "")
                                        : config.coin?.name ||
                                            config.coin?.symbol ||
                                            "N/A"
                                    )}</div>
                                    <div><strong>Enabled:</strong> ${
                                      config.enabled
                                        ? '<span style="color: var(--success);">Yes</span>'
                                        : '<span style="color: var(--danger);">No</span>'
                                    }</div>
                                    <div><strong>Address:</strong> <code>${this.escapeHtml(
                                      config.address || "N/A"
                                    )}</code></div>
                                    <div><strong>ASICBoost:</strong> ${
                                      config.asicboost
                                        ? '<span style="color: var(--success);">Enabled</span>'
                                        : '<span style="color: var(--text-muted);">Disabled</span>'
                                    }</div>
                                </div>
                            </div>

                            <div class="detail-section">
                                <h3><i class="fas fa-money-bill-wave"></i> Payment Settings</h3>
                                <div class="detail-grid">
                                    <div><strong>Pool Fee:</strong> ${
                                      config.paymentProcessing?.poolFee || 0
                                    }%</div>
                                    <div><strong>Solo Fee:</strong> ${
                                      config.paymentProcessing?.soloFee || 0
                                    }%</div>
                                    <div><strong>Min Payment:</strong> ${
                                      config.paymentProcessing
                                        ?.minimumPayment || "N/A"
                                    }</div>
                                    <div><strong>Min Payment (Solo):</strong> ${
                                      config.paymentProcessing
                                        ?.minimumPayment_solo || "N/A"
                                    }</div>
                                    <div><strong>Payment Interval:</strong> ${
                                      config.paymentProcessing?.paymentInterval
                                        ? config.paymentProcessing
                                            .paymentInterval /
                                            60 +
                                          " minutes"
                                        : "N/A"
                                    }</div>
                                    <div><strong>Payment Mode:</strong> ${
                                      config.paymentProcessing?.paymentMode?.toUpperCase() ||
                                      "N/A"
                                    }</div>
                                </div>
                            </div>

                            <div class="detail-section">
                                <h3><i class="fas fa-server"></i> Stratum Ports</h3>
                                <div class="ports-list">
                                    ${
                                      portsHtml ||
                                      '<p style="color: var(--text-muted);">No ports configured</p>'
                                    }
                                </div>
                            </div>

                            ${
                              stats
                                ? `
                            <div class="detail-section">
                                <h3><i class="fas fa-chart-line"></i> Live Statistics</h3>
                                <div class="detail-grid">
                                    <div><strong>Pool Hashrate:</strong> ${formatHashrate(
                                      stats.hashrate
                                    )}</div>
                                    <div><strong>Network Hashrate:</strong> ${
                                      stats.networkHashString ||
                                      formatHashrate(stats.networkHashrate)
                                    }</div>
                                    <div><strong>Miners:</strong> ${
                                      stats.minerCount
                                    } (${stats.poolMinerCount} pool, ${
                                    stats.soloMinerCount
                                  } solo)</div>
                                    <div><strong>Workers:</strong> ${
                                      stats.workerCount
                                    } (${stats.poolWorkerCount} pool, ${
                                    stats.soloWorkerCount
                                  } solo)</div>
                                    <div><strong>Network Difficulty:</strong> ${formatDifficulty(
                                      stats.networkDiff
                                    )}</div>
                                    <div><strong>Network Blocks:</strong> ${
                                      stats.networkBlocks || 0
                                    }</div>
                                </div>
                            </div>
                            `
                                : ""
                            }

                            ${
                              config.security
                                ? `
                            <div class="detail-section">
                                <h3><i class="fas fa-shield-alt"></i> Security Settings</h3>
                                <div class="detail-grid">
                                    <div><strong>Security:</strong> ${
                                      config.security.enabled
                                        ? '<span style="color: var(--success);">Enabled</span>'
                                        : '<span style="color: var(--danger);">Disabled</span>'
                                    }</div>
                                    <div><strong>Rate Limit:</strong> ${
                                      config.security.rateLimit?.enabled
                                        ? "Max " +
                                          config.security.rateLimit
                                            .maxConnections +
                                          " per " +
                                          config.security.rateLimit.window /
                                            1000 +
                                          "s"
                                        : "Disabled"
                                    }</div>
                                    <div><strong>Ban System:</strong> ${
                                      config.security.ban?.enabled
                                        ? config.security.ban.maxStrikes +
                                          " strikes, " +
                                          config.security.ban.duration / 1000 +
                                          "s ban"
                                        : "Disabled"
                                    }</div>
                                </div>
                            </div>
                            `
                                : ""
                            }
                        </div>
                    </div>
                </div>
            `;

      document.body.insertAdjacentHTML("beforeend", modalHtml);

      // Click outside to close
      document
        .getElementById("poolModal")
        .addEventListener("click", function (e) {
          if (e.target === this) {
            this.remove();
          }
        });
    },

    renderOverview: function (data) {
      if (!data) return;

      // Format hashrate helper
      const formatHashrate = (hr) => {
        if (!hr || hr === 0) return "0 H/s";
        const units = ["H/s", "KH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s"];
        let unitIndex = 0;
        let rate = hr;
        while (rate >= 1000 && unitIndex < units.length - 1) {
          rate /= 1000;
          unitIndex++;
        }
        return rate.toFixed(2) + " " + units[unitIndex];
      };

      // Format uptime
      const formatUptime = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
      };

      // Format time ago
      const timeAgo = (timestamp) => {
        if (!timestamp) return "";

        // Handle milliseconds timestamp
        const now = Date.now();
        const ts = timestamp > 9999999999 ? timestamp : timestamp * 1000;
        const diff = Math.floor((now - ts) / 1000);

        if (diff < 0) return "";
        if (diff < 60) return "< 1m ago";
        if (diff < 3600) return Math.floor(diff / 60) + "m ago";
        if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
        return Math.floor(diff / 86400) + "d ago";
      };

      // Render System Status Cards
      const systemStatusCards = document.getElementById("systemStatusCards");
      if (systemStatusCards && data.systemStatus) {
        const status = data.systemStatus;
        systemStatusCards.innerHTML = `
                    <div class="status-card">
                        <div class="status-card-icon" style="background: rgba(59, 130, 246, 0.1); color: var(--accent);">
                            <i class="fas fa-database"></i>
                        </div>
                        <div class="status-card-content">
                            <div class="status-card-label">Total Pools</div>
                            <div class="status-card-value">${
                              status.totalPools
                            }</div>
                            <div class="status-card-subtitle">${
                              status.activePools
                            } active</div>
                        </div>
                    </div>
                    <div class="status-card">
                        <div class="status-card-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--success);">
                            <i class="fas fa-users"></i>
                        </div>
                        <div class="status-card-content">
                            <div class="status-card-label">Active Miners</div>
                            <div class="status-card-value">${
                              status.totalMiners
                            }</div>
                            <div class="status-card-subtitle">across all pools</div>
                        </div>
                    </div>
                    <div class="status-card">
                        <div class="status-card-icon" style="background: rgba(168, 85, 247, 0.1); color: #a855f7;">
                            <i class="fas fa-tachometer-alt"></i>
                        </div>
                        <div class="status-card-content">
                            <div class="status-card-label">Total Hashrate</div>
                            <div class="status-card-value">${formatHashrate(
                              status.totalHashrate
                            )}</div>
                            <div class="status-card-subtitle">combined power</div>
                        </div>
                    </div>
                    <div class="status-card">
                        <div class="status-card-icon" style="background: rgba(245, 158, 11, 0.1); color: var(--warning);">
                            <i class="fas fa-clock"></i>
                        </div>
                        <div class="status-card-content">
                            <div class="status-card-label">System Uptime</div>
                            <div class="status-card-value">${formatUptime(
                              status.uptime
                            )}</div>
                            <div class="status-card-subtitle">since last start</div>
                        </div>
                    </div>
                `;
      }

      // Render Pool Summary Table
      const poolSummaryTable = document.getElementById("poolSummaryTable");
      if (poolSummaryTable && data.poolSummary) {
        const rows = data.poolSummary
          .map((pool) => {
            let coinName = pool.name.toUpperCase();
            if (pool.coin) {
              if (typeof pool.coin === "string") {
                coinName = pool.coin.replace(".json", "").toUpperCase();
              } else if (typeof pool.coin === "object") {
                coinName =
                  pool.coin.name || pool.coin.symbol || pool.name.toUpperCase();
              }
            }

            const statusIcons = {
              active: '<i class="fas fa-circle"></i>',
              idle: '<i class="fas fa-clock"></i>',
              inactive: '<i class="fas fa-times-circle"></i>',
            };

            return `
                        <tr>
                            <td><strong>${this.escapeHtml(
                              pool.name
                            )}</strong></td>
                            <td>${this.escapeHtml(coinName)}</td>
                            <td>
                                <span class="status-badge ${pool.status}">
                                    ${statusIcons[pool.status] || ""} ${
              pool.status
            }
                                </span>
                            </td>
                            <td>${pool.miners}</td>
                            <td>${formatHashrate(pool.hashrate)}</td>
                            <td>${pool.blocks}</td>
                        </tr>
                    `;
          })
          .join("");

        poolSummaryTable.innerHTML = `
                    <table class="summary-table">
                        <thead>
                            <tr>
                                <th>Pool</th>
                                <th>Coin</th>
                                <th>Status</th>
                                <th>Miners</th>
                                <th>Hashrate</th>
                                <th>Blocks</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${
                              rows ||
                              '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No pools available</td></tr>'
                            }
                        </tbody>
                    </table>
                `;
      }

      // Render Recent Activity
      const recentActivity = document.getElementById("recentActivity");
      if (recentActivity && data.recentActivity) {
        const activity = data.recentActivity;

        // Recent Blocks
        const blocksHtml =
          activity.blocks && activity.blocks.length > 0
            ? activity.blocks
                .slice(0, 5)
                .map(
                  (block) => `
                        <div class="activity-item">
                            <div class="activity-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--success);">
                                <i class="fas fa-cube"></i>
                            </div>
                            <div class="activity-details">
                                <div class="activity-title">Block ${
                                  block.height
                                }</div>
                                <div class="activity-meta">${this.escapeHtml(
                                  block.pool
                                )} · ${this.escapeHtml(
                    block.miner.substring(0, 16)
                  )}...</div>
                            </div>
                            <div class="activity-time">${timeAgo(
                              block.time
                            )}</div>
                        </div>
                    `
                )
                .join("")
            : '<p style="color: var(--text-muted); font-size: 0.9rem;">No recent blocks</p>';

        // Recent Payments
        const paymentsHtml =
          activity.payments && activity.payments.length > 0
            ? activity.payments
                .slice(0, 5)
                .map((payment) => {
                  const timeStr = timeAgo(payment.time);
                  return `
                        <div class="activity-item">
                            <div class="activity-icon" style="background: rgba(59, 130, 246, 0.1); color: var(--accent);">
                                <i class="fas fa-coins"></i>
                            </div>
                            <div class="activity-details">
                                <div class="activity-title">${
                                  payment.paid
                                } ${this.escapeHtml(
                    payment.symbol || payment.coin
                  )}</div>
                                <div class="activity-meta">${this.escapeHtml(
                                  payment.pool
                                )} · ${payment.miners} ${
                    payment.miners === 1 ? "miner" : "miners"
                  }${payment.isSolo ? " (SOLO)" : ""}</div>
                            </div>
                            ${
                              timeStr
                                ? `<div class="activity-time">${timeStr}</div>`
                                : ""
                            }
                        </div>
                    `;
                })
                .join("")
            : '<p style="color: var(--text-muted); font-size: 0.9rem;">No recent payments</p>';

        recentActivity.innerHTML = `
                    <div class="activity-section">
                        <h4><i class="fas fa-cube"></i> Recent Blocks</h4>
                        <div class="activity-list">${blocksHtml}</div>
                    </div>
                    <div class="activity-section">
                        <h4><i class="fas fa-coins"></i> Recent Payments</h4>
                        <div class="activity-list">${paymentsHtml}</div>
                    </div>
                    <div class="activity-section">
                        <h4><i class="fas fa-plug"></i> Live Connections</h4>
                        <div class="stat-box" style="margin: 0;">
                            <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: var(--warning);">
                                <i class="fas fa-broadcast-tower"></i>
                            </div>
                            <div class="stat-details">
                                <div class="stat-label">Active Connections</div>
                                <div class="stat-value">${
                                  activity.connections || 0
                                }</div>
                                <div class="stat-meta" style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">
                                    Real-time monitoring connections from frontend clients viewing live pool statistics
                                </div>
                            </div>
                        </div>
                    </div>
                `;
      }

      // Render System Health
      const systemHealth = document.getElementById("systemHealth");
      if (systemHealth && data.systemHealth) {
        const health = data.systemHealth;

        // API Health
        const apiStatusClass =
          health.api.status === "operational"
            ? "operational"
            : health.api.errorRate > 5
            ? "error"
            : "warning";

        let apiHealthHtml = `
                    <div class="health-section">
                        <div class="health-header">
                            <h4><i class="fas fa-server"></i> API Health</h4>
                            <div class="health-status ${apiStatusClass}">
                                <i class="fas ${
                                  apiStatusClass === "operational"
                                    ? "fa-check-circle"
                                    : apiStatusClass === "error"
                                    ? "fa-times-circle"
                                    : "fa-exclamation-triangle"
                                }"></i>
                                ${health.api.status}
                            </div>
                        </div>
                        <div class="health-metrics">
                            <div class="health-metric">
                                <div class="health-metric-label">Total Requests</div>
                                <div class="health-metric-value">${
                                  health.api.requests
                                }</div>
                            </div>
                            <div class="health-metric">
                                <div class="health-metric-label">Errors</div>
                                <div class="health-metric-value">${
                                  health.api.errors
                                }</div>
                            </div>
                            <div class="health-metric">
                                <div class="health-metric-label">Error Rate</div>
                                <div class="health-metric-value">${
                                  health.api.errorRate
                                }%</div>
                            </div>
                            <div class="health-metric">
                                <div class="health-metric-label">Avg Response</div>
                                <div class="health-metric-value">${
                                  health.api.avgResponseTime
                                }ms</div>
                            </div>
                        </div>
                    </div>
                `;

        // Pool Health
        if (health.pools && health.pools.length > 0) {
          const poolHealthHtml = health.pools
            .map((pool) => {
              const hasIssues = pool.issues && pool.issues.length > 0;
              const issuesHtml = hasIssues
                ? `<div class="health-issues">
                                ${pool.issues
                                  .map(
                                    (issue) => `
                                    <div class="health-issue">
                                        <i class="fas fa-exclamation-triangle"></i>
                                        ${this.escapeHtml(issue)}
                                    </div>
                                `
                                  )
                                  .join("")}
                            </div>`
                : "";

              return `
                            <div class="health-section">
                                <div class="health-header">
                                    <h4><i class="fas fa-database"></i> ${this.escapeHtml(
                                      pool.pool
                                    )}</h4>
                                    <div class="health-status ${pool.status}">
                                        <i class="fas ${
                                          pool.status === "operational"
                                            ? "fa-check-circle"
                                            : pool.status === "error"
                                            ? "fa-times-circle"
                                            : "fa-exclamation-triangle"
                                        }"></i>
                                        ${pool.status}
                                    </div>
                                </div>
                                ${issuesHtml}
                            </div>
                        `;
            })
            .join("");

          apiHealthHtml += poolHealthHtml;
        }

        systemHealth.innerHTML = apiHealthHtml;
      }
    },

    renderLogFiles: function (files) {
      const logFilesList = document.getElementById("logFilesList");
      if (!logFilesList) return;

      if (!files || files.length === 0) {
        logFilesList.innerHTML =
          '<p style="color: var(--text-muted);">No log files found</p>';
        return;
      }

      const formatFileSize = (bytes) => {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return (
          Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i]
        );
      };

      const formatDate = (timestamp) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return "just now";
        if (diffMins < 60) return diffMins + "m ago";
        if (diffMins < 1440) return Math.floor(diffMins / 60) + "h ago";

        return date.toLocaleDateString();
      };

      const filesHtml = files
        .map(
          (file) => `
                <div class="log-file-item" data-filename="${this.escapeHtml(
                  file.name
                )}">
                    <div class="log-file-name">
                        <i class="fas fa-file-alt"></i>
                        ${this.escapeHtml(file.name)}
                    </div>
                    <div class="log-file-meta">
                        <span>${formatFileSize(file.size)}</span>
                        <span>${formatDate(file.modified)}</span>
                    </div>
                </div>
            `
        )
        .join("");

      logFilesList.innerHTML = filesHtml;

      // Attach click handlers
      document.querySelectorAll(".log-file-item").forEach((item) => {
        item.addEventListener("click", () => {
          const filename = item.getAttribute("data-filename");
          this.loadLogFile(filename);

          // Update active state
          document
            .querySelectorAll(".log-file-item")
            .forEach((i) => i.classList.remove("active"));
          item.classList.add("active");
        });
      });

      // Attach control handlers
      const refreshBtn = document.getElementById("refreshLogBtn");
      const clearBtn = document.getElementById("clearLogViewBtn");
      const linesSelect = document.getElementById("logLinesSelect");

      if (refreshBtn && !refreshBtn.hasAttribute("data-handler")) {
        refreshBtn.setAttribute("data-handler", "true");
        refreshBtn.addEventListener("click", () => {
          const activeFile = document.querySelector(".log-file-item.active");
          if (activeFile) {
            const filename = activeFile.getAttribute("data-filename");
            this.loadLogFile(filename);
          }
        });
      }

      if (clearBtn && !clearBtn.hasAttribute("data-handler")) {
        clearBtn.setAttribute("data-handler", "true");
        clearBtn.addEventListener("click", () => {
          const logContent = document.getElementById("logViewerContent");
          const currentLogFile = document.getElementById("currentLogFile");
          if (logContent) {
            logContent.innerHTML = `
                            <div class="log-viewer-placeholder">
                                <i class="fas fa-file-alt" style="font-size: 4rem; opacity: 0.3;"></i>
                                <p>Select a log file from the list to view its contents</p>
                            </div>
                        `;
          }
          if (currentLogFile) {
            currentLogFile.textContent = "Select a log file";
          }
          document
            .querySelectorAll(".log-file-item")
            .forEach((i) => i.classList.remove("active"));
        });
      }

      if (linesSelect && !linesSelect.hasAttribute("data-handler")) {
        linesSelect.setAttribute("data-handler", "true");
        linesSelect.addEventListener("change", () => {
          const activeFile = document.querySelector(".log-file-item.active");
          if (activeFile) {
            const filename = activeFile.getAttribute("data-filename");
            this.loadLogFile(filename);
          }
        });
      }
    },

    loadLogFile: function (filename) {
      const linesSelect = document.getElementById("logLinesSelect");
      const lines = linesSelect ? parseInt(linesSelect.value) : 500;

      AdminAPI.loadLogContent(filename, lines);
    },

    renderLogContent: function (data) {
      const logContent = document.getElementById("logViewerContent");
      const currentLogFile = document.getElementById("currentLogFile");

      if (!logContent || !data) return;

      if (currentLogFile) {
        currentLogFile.textContent = data.filename;
      }

      if (!data.lines || data.lines.length === 0) {
        logContent.innerHTML =
          '<div class="log-viewer-placeholder"><p>Log file is empty</p></div>';
        return;
      }

      // Detect log level and apply styling
      const detectLogLevel = (line) => {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes("error") || lowerLine.includes("[error]"))
          return "error";
        if (lowerLine.includes("warning") || lowerLine.includes("[warning]"))
          return "warning";
        if (lowerLine.includes("[info]")) return "info";
        if (lowerLine.includes("[debug]")) return "debug";
        if (lowerLine.includes("success") || lowerLine.includes("accepted"))
          return "success";
        return "";
      };

      const linesHtml = data.lines
        .map((line) => {
          if (!line || line.trim() === "") return "";
          const level = detectLogLevel(line);
          return `<div class="log-line ${level}">${this.escapeHtml(
            line
          )}</div>`;
        })
        .join("");

      logContent.innerHTML =
        linesHtml +
        `
                <div class="log-stats">
                    <span>Showing last ${data.lines.length} lines</span>
                    <span>Total lines: ${data.totalLines.toLocaleString()}</span>
                </div>
            `;

      // Scroll to bottom
      logContent.scrollTop = logContent.scrollHeight;
    },

    escapeHtml: function (unsafe) {
      if (typeof unsafe !== "string") return unsafe;
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    },
  };

  // API Communication
  const AdminAPI = {
    async login(password, remember) {
      try {
        const response = await fetch("/api/admin/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ password: password }),
        });

        if (response.status === 401) {
          // Record failed attempt
          const delay = AdminState.recordFailedAttempt();

          // Calculate remaining attempts before first lockout
          const attemptsBeforeLockout = 3;
          const attemptsRemaining = Math.max(
            0,
            attemptsBeforeLockout - AdminState.failedAttempts
          );

          if (AdminState.failedAttempts < attemptsBeforeLockout) {
            AdminUI.showError(
              "Incorrect password. " +
                attemptsRemaining +
                " attempt" +
                (attemptsRemaining === 1 ? "" : "s") +
                " remaining before lockout."
            );
          } else {
            // Lockout triggered
            AdminState.checkLockout();
          }
          throw new Error("Unauthorized");
        }

        if (response.status === 429) {
          AdminUI.showError(
            "Too many requests. Please wait a moment and try again."
          );
          throw new Error("Rate limited");
        }

        if (!response.ok) {
          AdminUI.showError("Login failed: " + response.statusText);
          throw new Error("Request failed: " + response.statusText);
        }

        const data = await response.json();
        return data;
      } catch (error) {
        console.error("Login error:", error);
        throw error;
      }
    },

    async logout() {
      try {
        await fetch("/api/admin/logout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId: AdminState.sessionId,
          }),
        });
      } catch (error) {
        console.error("Logout error:", error);
      }
    },

    async request(method, data = {}) {
      if (!AdminState.sessionId || !AdminState.token) {
        throw new Error("Not authenticated");
      }

      // Separate query parameters from body data
      const queryParams = {};
      const bodyData = {
        sessionId: AdminState.sessionId,
        token: AdminState.token,
      };

      // For logs endpoint, action/file/lines go in query string
      if (method === 'logs') {
        if (data.action) queryParams.action = data.action;
        if (data.file) queryParams.file = data.file;
        if (data.lines) queryParams.lines = data.lines;
      } else {
        // For other methods, keep data in body
        Object.assign(bodyData, data);
      }

      // Build URL with query parameters
      let url = "/api/admin/" + method;
      const queryString = new URLSearchParams(queryParams).toString();
      if (queryString) {
        url += "?" + queryString;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bodyData),
      });

      if (response.status === 401) {
        AdminState.clearSession();
        AdminUI.showLogin();
        AdminUI.showError("Session expired or invalid. Please log in again.");
        throw new Error("Unauthorized");
      }

      if (response.status === 429) {
        AdminUI.showError(
          "Too many requests. Please wait a moment and try again."
        );
        throw new Error("Rate limited");
      }

      if (!response.ok) {
        throw new Error("Request failed: " + response.statusText);
      }

      return await response.json();
    },

    async loadPools() {
      try {
        const response = await this.request("pools");
        console.log("Pool response:", response);
        if (response && response.result) {
          console.log("Rendering pools:", response.result);
          AdminUI.renderPools(response.result);
        } else {
          console.error("No result in response:", response);
          AdminUI.elements.poolsList.innerHTML =
            '<p style="color: var(--danger);">No pools data received from server.</p>';
        }
      } catch (error) {
        console.error("Error loading pools:", error);
        console.error("Error stack:", error.stack);
        AdminUI.elements.poolsList.innerHTML =
          '<p style="color: var(--danger);">Failed to load pools: ' +
          error.message +
          "</p>";
      }
    },

    async loadOverview() {
      try {
        const response = await this.request("overview");
        console.log("Overview response:", response);
        if (response && response.result) {
          console.log("Rendering overview:", response.result);
          AdminUI.renderOverview(response.result);
        } else {
          console.error("No result in overview response:", response);
          const systemStatusCards =
            document.getElementById("systemStatusCards");
          if (systemStatusCards) {
            systemStatusCards.innerHTML =
              '<p style="color: var(--danger);">No overview data received from server.</p>';
          }
        }
      } catch (error) {
        console.error("Error loading overview:", error);
        console.error("Error stack:", error.stack);
        const systemStatusCards = document.getElementById("systemStatusCards");
        if (systemStatusCards) {
          systemStatusCards.innerHTML =
            '<p style="color: var(--danger);">Failed to load overview: ' +
            error.message +
            "</p>";
        }
      }
    },

    async loadLogs() {
      try {
        const data = await this.request("logs", { action: "list" });
        console.log("Logs list response:", data);

        if (data && data.result) {
          AdminUI.renderLogFiles(data.result);
        } else {
          console.error("No result in logs response:", data);
          const logFilesList = document.getElementById("logFilesList");
          if (logFilesList) {
            logFilesList.innerHTML =
              '<p style="color: var(--danger);">No logs data received from server.</p>';
          }
        }
      } catch (error) {
        console.error("Error loading logs:", error);
        const logFilesList = document.getElementById("logFilesList");
        if (logFilesList) {
          logFilesList.innerHTML =
            '<p style="color: var(--danger);">Failed to load logs: ' +
            error.message +
            "</p>";
        }
      }
    },

    async loadLogContent(filename, lines = 500) {
      try {
        const data = await this.request("logs", {
          action: "read",
          file: filename,
          lines: lines,
        });
        console.log("Log content response:", data);

        if (data && data.result) {
          AdminUI.renderLogContent(data.result);
        } else if (data.error) {
          console.error("Error reading log:", data.error);
          const logContent = document.getElementById("logViewerContent");
          if (logContent) {
            logContent.innerHTML =
              '<div class="log-viewer-placeholder"><p style="color: var(--danger);">' +
              data.error +
              "</p></div>";
          }
        } else {
          console.error("No result in log content response:", data);
        }
      } catch (error) {
        console.error("Error loading log content:", error);
        const logContent = document.getElementById("logViewerContent");
        if (logContent) {
          logContent.innerHTML =
            '<div class="log-viewer-placeholder"><p style="color: var(--danger);">Failed to load log: ' +
            error.message +
            "</p></div>";
        }
      }
    },
  };

  // Settings Management
  const AdminSettings = {
    currentSettings: null,
    restartRequired: false,

    loadSettings: async function () {
      try {
        const response = await AdminAPI.request("settings", {
          action: "get_configs",
        });

        if (response && response.result) {
          this.currentSettings = response.result;
          this.renderSettings(response.result);
        } else {
          console.error("No settings data received");
        }
      } catch (error) {
        console.error("Error loading settings:", error);
      }
    },

    renderSettings: function (data) {
      // Format uptime
      const formatUptime = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
      };

      // Update system info
      const poolUptime = document.getElementById("poolUptime");
      const activeMinersCount = document.getElementById("activeMinersCount");

      if (poolUptime && data.systemInfo) {
        poolUptime.textContent = formatUptime(data.systemInfo.uptime);
      }
      if (activeMinersCount && data.systemInfo) {
        activeMinersCount.textContent = data.systemInfo.activeMiners;
      }

      // Render pool configs list
      const poolConfigsList = document.getElementById("poolConfigsList");
      if (!poolConfigsList) return;

      const poolConfigs = data.poolConfigs;
      const configItems = Object.entries(poolConfigs)
        .map(([poolName, config]) => {
          const isEnabled = config.enabled !== false;
          const poolFee = config.paymentProcessing?.poolFee || 0;
          const minPayment = config.paymentProcessing?.minimumPayment || "N/A";

          return `
                    <div class="config-item">
                        <div class="config-item-info">
                            <div class="config-item-name">
                                <i class="fas fa-cube"></i>
                                ${AdminUI.escapeHtml(poolName)}
                                ${
                                  isEnabled
                                    ? '<span style="color: var(--success); font-size: 0.75rem; margin-left: 0.5rem;">(Enabled)</span>'
                                    : '<span style="color: var(--text-muted); font-size: 0.75rem; margin-left: 0.5rem;">(Disabled)</span>'
                                }
                            </div>
                            <div class="config-item-meta">
                                Fee: ${poolFee}% • Min Payment: ${minPayment}
                            </div>
                        </div>
                        <div class="config-item-actions">
                            <button class="btn-config-action" data-action="edit" data-pool="${AdminUI.escapeHtml(
                              poolName
                            )}">
                                <i class="fas fa-edit"></i> Edit
                            </button>
                        </div>
                    </div>
                `;
        })
        .join("");

      poolConfigsList.innerHTML = configItems;

      // Attach event listeners
      document
        .querySelectorAll('.btn-config-action[data-action="edit"]')
        .forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const poolName = e.currentTarget.getAttribute("data-pool");
            this.showConfigEditor(poolName, poolConfigs[poolName]);
          });
        });

      // Load website config values
      if (data.websiteConfig) {
        const updateIntervalInput = document.getElementById("updateInterval");
        const historicalRetentionInput = document.getElementById(
          "historicalRetention"
        );
        const hashrateWindowInput = document.getElementById("hashrateWindow");

        if (updateIntervalInput)
          updateIntervalInput.value = data.websiteConfig.updateInterval;
        if (historicalRetentionInput)
          historicalRetentionInput.value =
            data.websiteConfig.historicalRetention;
        if (hashrateWindowInput)
          hashrateWindowInput.value = data.websiteConfig.hashrateWindow;
      }

      // Attach restart button listener
      const restartBtn = document.getElementById("btnRestartPool");
      if (restartBtn && !restartBtn.hasAttribute("data-handler")) {
        restartBtn.setAttribute("data-handler", "true");
        restartBtn.addEventListener("click", () => this.confirmRestart());
      }

      // Attach website config save button listener
      const saveWebsiteBtn = document.getElementById("btnSaveWebsiteConfig");
      if (saveWebsiteBtn && !saveWebsiteBtn.hasAttribute("data-handler")) {
        saveWebsiteBtn.setAttribute("data-handler", "true");
        saveWebsiteBtn.addEventListener("click", () =>
          this.saveWebsiteConfig()
        );
      }
    },

    showConfigEditor: function (poolName, config) {
      alert(
        "Config editor not fully implemented. Please edit " +
          poolName +
          ".json manually for now."
      );
      // Future: Create modal with form fields for editing
    },

    confirmRestart: function () {
      const activeMiners = this.currentSettings?.systemInfo?.activeMiners || 0;

      const dialogHtml = `
                <div class="confirm-dialog-overlay" id="confirmRestartDialog">
                    <div class="confirm-dialog">
                        <div class="confirm-dialog-header">
                            <h3><i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i> Confirm Pool Restart</h3>
                        </div>
                        <div class="confirm-dialog-body">
                            <p><strong>WARNING:</strong> This will restart the entire mining pool system.</p>
                            <p>• All miners will be temporarily disconnected</p>
                            <p>• Current active miners: <strong>${activeMiners}</strong></p>
                            <p>• Pool will be back online in ~30 seconds</p>
                            <p style="margin-top: 1rem;">Type <strong>RESTART</strong> to confirm:</p>
                            <input type="text" id="restartConfirmInput"
                                style="width: 100%; padding: 0.75rem; margin-top: 0.5rem;
                                background: var(--bg-secondary); border: 1px solid var(--border);
                                border-radius: 0.375rem; color: var(--text-primary); font-size: 1rem;"
                                placeholder="Type RESTART here">
                        </div>
                        <div class="confirm-dialog-footer">
                            <button class="btn-confirm-cancel" id="btnCancelRestart">Cancel</button>
                            <button class="btn-confirm-danger" id="btnConfirmRestart">Restart Pool</button>
                        </div>
                    </div>
                </div>
            `;

      document.body.insertAdjacentHTML("beforeend", dialogHtml);

      const dialog = document.getElementById("confirmRestartDialog");
      const confirmInput = document.getElementById("restartConfirmInput");
      const cancelBtn = document.getElementById("btnCancelRestart");
      const confirmBtn = document.getElementById("btnConfirmRestart");

      // Close on cancel
      cancelBtn.addEventListener("click", () => dialog.remove());

      // Close on click outside
      dialog.addEventListener("click", (e) => {
        if (e.target === dialog) dialog.remove();
      });

      // Handle confirm
      confirmBtn.addEventListener("click", () => {
        const input = confirmInput.value.trim();
        if (input === "RESTART") {
          dialog.remove();
          this.restartPool();
        } else {
          confirmInput.style.borderColor = "var(--danger)";
          confirmInput.placeholder = "You must type RESTART exactly";
          setTimeout(() => {
            confirmInput.style.borderColor = "";
            confirmInput.placeholder = "Type RESTART here";
          }, 2000);
        }
      });

      // Focus input
      setTimeout(() => confirmInput.focus(), 100);
    },

    restartPool: async function () {
      const restartBtn = document.getElementById("btnRestartPool");
      const statusText = document.getElementById("poolStatusText");

      // Disable button and show restarting state
      if (restartBtn) {
        restartBtn.disabled = true;
        restartBtn.classList.add("restarting");
        restartBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Restarting...';
      }
      if (statusText) {
        statusText.textContent = "Restarting";
      }

      try {
        const response = await AdminAPI.request("settings", {
          action: "restart",
          confirmation: "RESTART",
        });

        if (response && response.result === "success") {
          console.log("Pool restart initiated:", response.message);

          // Show message to user
          alert(
            "Pool restart initiated successfully. The pool will be back online in approximately 30 seconds. You may need to refresh this page."
          );

          // Optionally reload page after delay
          setTimeout(() => {
            if (confirm("Would you like to reload the admin panel now?")) {
              window.location.reload();
            }
          }, 5000);
        }
      } catch (error) {
        console.error("Restart error:", error);
        alert("Failed to restart pool: " + error.message);

        // Re-enable button
        if (restartBtn) {
          restartBtn.disabled = false;
          restartBtn.classList.remove("restarting");
          restartBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Restart Pool';
        }
        if (statusText) {
          statusText.textContent = "Operational";
        }
      }
    },

    saveWebsiteConfig: async function () {
      const updateIntervalInput = document.getElementById("updateInterval");
      const historicalRetentionInput = document.getElementById(
        "historicalRetention"
      );
      const hashrateWindowInput = document.getElementById("hashrateWindow");
      const saveBtn = document.getElementById("btnSaveWebsiteConfig");
      const statusDiv = document.getElementById("websiteConfigStatus");

      // Get values
      const updateInterval = parseInt(updateIntervalInput.value);
      const historicalRetention = parseInt(historicalRetentionInput.value);
      const hashrateWindow = parseInt(hashrateWindowInput.value);

      // Validate inputs
      if (
        isNaN(updateInterval) ||
        updateInterval < 10 ||
        updateInterval > 300
      ) {
        this.showWebsiteConfigMessage(
          "Update interval must be between 10 and 300 seconds",
          "error"
        );
        return;
      }
      if (
        isNaN(historicalRetention) ||
        historicalRetention < 3600 ||
        historicalRetention > 86400
      ) {
        this.showWebsiteConfigMessage(
          "Historical retention must be between 3600 and 86400 seconds (1-24 hours)",
          "error"
        );
        return;
      }
      if (
        isNaN(hashrateWindow) ||
        hashrateWindow < 60 ||
        hashrateWindow > 1800
      ) {
        this.showWebsiteConfigMessage(
          "Hashrate window must be between 60 and 1800 seconds (1-30 minutes)",
          "error"
        );
        return;
      }

      // Disable button and show saving state
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
      }

      try {
        const response = await AdminAPI.request("settings", {
          action: "update_website_config",
          updateInterval: updateInterval,
          historicalRetention: historicalRetention,
          hashrateWindow: hashrateWindow,
        });

        if (response && response.result === "success") {
          console.log("Website config updated:", response.message);
          this.showWebsiteConfigMessage(response.message, "success");

          // Update current settings
          if (this.currentSettings && this.currentSettings.websiteConfig) {
            this.currentSettings.websiteConfig.updateInterval = updateInterval;
            this.currentSettings.websiteConfig.historicalRetention =
              historicalRetention;
            this.currentSettings.websiteConfig.hashrateWindow = hashrateWindow;
          }

          // Show restart reminder if needed
          if (response.restartRequired) {
            setTimeout(() => {
              if (
                confirm(
                  "Website configuration updated successfully. A pool restart is required to apply the changes. Would you like to restart now?"
                )
              ) {
                this.confirmRestart();
              }
            }, 1000);
          }
        } else if (response && response.error) {
          this.showWebsiteConfigMessage(response.error, "error");
        }
      } catch (error) {
        console.error("Save website config error:", error);
        this.showWebsiteConfigMessage(
          "Failed to save configuration: " + error.message,
          "error"
        );
      } finally {
        // Re-enable button
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML =
            '<i class="fas fa-save"></i> Save Website Configuration';
        }
      }
    },

    showWebsiteConfigMessage: function (message, type = "success") {
      const statusDiv = document.getElementById("websiteConfigStatus");
      if (!statusDiv) return;

      statusDiv.style.display = "block";
      statusDiv.className = "";
      statusDiv.style.padding = "1rem";
      statusDiv.style.borderRadius = "0.375rem";
      statusDiv.style.marginTop = "1rem";

      if (type === "success") {
        statusDiv.style.background = "rgba(16, 185, 129, 0.1)";
        statusDiv.style.border = "1px solid rgba(16, 185, 129, 0.3)";
        statusDiv.style.color = "var(--success)";
        statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> ' + message;
      } else {
        statusDiv.style.background = "rgba(239, 68, 68, 0.1)";
        statusDiv.style.border = "1px solid rgba(239, 68, 68, 0.3)";
        statusDiv.style.color = "var(--danger)";
        statusDiv.innerHTML =
          '<i class="fas fa-exclamation-circle"></i> ' + message;
      }

      // Auto-hide after 5 seconds
      setTimeout(() => {
        statusDiv.style.display = "none";
      }, 5000);
    },
  };

  // Pool Message Management - expose globally for inline onclick handlers
  window.PoolMessage = {
    currentMessage: null,
    colorIcons: {
      blue: "fa-info-circle",
      green: "fa-check-circle",
      yellow: "fa-exclamation-triangle",
      red: "fa-exclamation-circle",
    },

    loadPoolMessage: async function () {
      try {
        const response = await AdminAPI.request("pool_message", {
          action: "get",
        });

        if (response && response.result) {
          this.currentMessage = response.result;
          this.populateForm(response.result);
          this.displayCurrentMessage(response.result);
        } else {
          // No message exists, show empty state
          this.currentMessage = null;
          this.populateForm(null);
          this.displayCurrentMessage(null);
        }
      } catch (error) {
        console.error("Error loading pool message:", error);
      }

      // Attach event listeners
      this.attachEventListeners();
    },

    attachEventListeners: function () {
      // Event handlers are now inline in HTML for better reliability
      // Just initialize the preview
      setTimeout(() => this.updatePreview(), 100);
    },

    populateForm: function (message) {
      // Use specific selectors to target only the active section
      const messageText = document.querySelector(
        "#section-pool-message.active #poolMessageText"
      );
      const messageEnabled = document.querySelector(
        "#section-pool-message.active #poolMessageEnabled"
      );

      if (message) {
        if (messageText) messageText.value = message.text || "";
        if (messageEnabled) messageEnabled.checked = message.enabled || false;

        // Set color radio
        const colorRadio = document.querySelector(
          "#section-pool-message.active #color" +
            this.capitalizeFirst(message.color || "blue")
        );
        if (colorRadio) colorRadio.checked = true;
      } else {
        // Clear form
        if (messageText) messageText.value = "";
        if (messageEnabled) messageEnabled.checked = false;
        const blueRadio = document.querySelector(
          "#section-pool-message.active #colorBlue"
        );
        if (blueRadio) blueRadio.checked = true;
      }
    },

    updatePreview: function () {
      // Use specific selectors to target only the active section
      const messageText = document.querySelector(
        "#section-pool-message.active #poolMessageText"
      );
      const selectedColor = document.querySelector(
        '#section-pool-message.active input[name="messageColor"]:checked'
      );
      const preview = document.querySelector(
        "#section-pool-message.active #messagePreview"
      );
      const previewText = document.querySelector(
        "#section-pool-message.active #messagePreviewText"
      );

      if (!messageText || !selectedColor || !preview || !previewText) {
        console.log("Preview elements not found:", {
          messageText: !!messageText,
          selectedColor: !!selectedColor,
          preview: !!preview,
          previewText: !!previewText,
        });
        return;
      }

      const text =
        messageText.value.trim() || "Your message will appear here...";
      const color = selectedColor.value;

      // Update text
      previewText.textContent = text;

      // Update color class
      preview.className = "message-preview message-preview-" + color;

      // Update icon - get fresh reference
      const previewIcon = preview.querySelector("i");
      if (previewIcon) {
        previewIcon.className = "fas " + this.colorIcons[color];
      }
    },

    displayCurrentMessage: function (message) {
      // Use specific selector to target only the active section
      const displayDiv = document.querySelector(
        "#section-pool-message.active #currentPoolMessageDisplay"
      );
      if (!displayDiv) return;

      if (!message) {
        displayDiv.innerHTML = `
                    <p style="color: var(--text-muted); text-align: center; padding: 2rem;">
                        <i class="fas fa-inbox" style="font-size: 3rem; opacity: 0.3; display: block; margin-bottom: 1rem;"></i>
                        No message created yet
                    </p>
                `;
        return;
      }

      // Show message even if disabled, but indicate status
      if (!message.enabled) {
        displayDiv.innerHTML = `
                    <div style="padding: 1rem; background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 0.5rem; margin-bottom: 1rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; color: #f59e0b; margin-bottom: 0.5rem;">
                            <i class="fas fa-eye-slash"></i>
                            <strong>Message is Disabled</strong>
                        </div>
                        <p style="color: var(--text-secondary); font-size: 0.9rem; margin: 0;">
                            This message exists but is not displayed on the homepage. Check the "Enable Message" checkbox and save to activate it.
                        </p>
                    </div>
                    <div class="message-preview message-preview-${
                      message.color
                    }" style="margin: 0;">
                        <div class="message-preview-content">
                            <i class="fas ${
                              this.colorIcons[message.color]
                            }"></i>
                            <span>${AdminUI.escapeHtml(message.text)}</span>
                        </div>
                    </div>
                    <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border);">
                        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem; font-size: 0.85rem; color: var(--text-secondary);">
                            <div>
                                <strong>Status:</strong>
                                <span style="color: var(--warning);">
                                    <i class="fas fa-eye-slash"></i> Disabled
                                </span>
                            </div>
                            <div>
                                <strong>Type:</strong> ${this.capitalizeFirst(
                                  message.color
                                )}
                            </div>
                            <div>
                                <strong>Created:</strong> ${this.formatDate(
                                  message.createdAt
                                )}
                            </div>
                            <div>
                                <strong>Updated:</strong> ${this.formatDate(
                                  message.updatedAt
                                )}
                            </div>
                        </div>
                    </div>
                `;
        return;
      }

      const color = message.color || "blue";
      const icon = this.colorIcons[color];

      displayDiv.innerHTML = `
                <div class="message-preview message-preview-${color}" style="margin: 0;">
                    <div class="message-preview-content">
                        <i class="fas ${icon}"></i>
                        <span>${AdminUI.escapeHtml(message.text)}</span>
                    </div>
                </div>
                <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border);">
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem; font-size: 0.85rem; color: var(--text-secondary);">
                        <div>
                            <strong>Status:</strong>
                            <span style="color: var(--success);">
                                <i class="fas fa-check-circle"></i> Active
                            </span>
                        </div>
                        <div>
                            <strong>Type:</strong> ${this.capitalizeFirst(
                              color
                            )}
                        </div>
                        <div>
                            <strong>Created:</strong> ${this.formatDate(
                              message.createdAt
                            )}
                        </div>
                        <div>
                            <strong>Updated:</strong> ${this.formatDate(
                              message.updatedAt
                            )}
                        </div>
                    </div>
                </div>
            `;
    },

    saveMessage: async function () {
      // Use specific selectors to target only the active section
      const messageText = document.querySelector(
        "#section-pool-message.active #poolMessageText"
      );
      const messageEnabled = document.querySelector(
        "#section-pool-message.active #poolMessageEnabled"
      );
      const selectedColor = document.querySelector(
        '#section-pool-message.active input[name="messageColor"]:checked'
      );
      const saveBtn = document.querySelector(
        "#section-pool-message.active #btnSavePoolMessage"
      );

      // Debug logging
      console.log("Save message called");
      console.log("messageText element:", messageText);
      console.log(
        "messageText value:",
        messageText ? messageText.value : "element not found"
      );
      console.log(
        "messageEnabled:",
        messageEnabled ? messageEnabled.checked : "element not found"
      );
      console.log(
        "selectedColor:",
        selectedColor ? selectedColor.value : "element not found"
      );

      if (!messageText) {
        this.showMessage(
          "Error: Message text field not found. Please refresh the page.",
          "error"
        );
        return;
      }

      const text = messageText.value.trim();
      const color = selectedColor ? selectedColor.value : "blue";
      const enabled = messageEnabled ? messageEnabled.checked : false;

      console.log("Trimmed text:", text);
      console.log("Text length:", text.length);

      // Validation
      if (!text) {
        this.showMessage("Please enter a message text", "error");
        return;
      }

      if (text.length > 500) {
        this.showMessage(
          "Message text must be 500 characters or less",
          "error"
        );
        return;
      }

      // Disable button
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
      }

      try {
        const response = await AdminAPI.request("pool_message", {
          action: "set",
          text: text,
          color: color,
          enabled: enabled,
        });

        if (response && response.result === "success") {
          this.showMessage(
            response.message || "Pool message saved successfully",
            "success"
          );

          // Update the current message object
          this.currentMessage = {
            id: this.currentMessage
              ? this.currentMessage.id
              : "pool-message-" + Date.now(),
            text: text,
            color: color,
            enabled: enabled,
            createdAt: this.currentMessage
              ? this.currentMessage.createdAt
              : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          // Immediately update the display without waiting
          this.displayCurrentMessage(this.currentMessage);

          // Also reload from server to sync with server state
          setTimeout(() => {
            this.loadPoolMessage();
          }, 500);
        } else if (response && response.error) {
          this.showMessage(response.error, "error");
        }
      } catch (error) {
        console.error("Save pool message error:", error);
        this.showMessage("Failed to save message: " + error.message, "error");
      } finally {
        // Re-enable button
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Message';
        }
      }
    },

    confirmClearMessage: function () {
      if (
        confirm(
          "Are you sure you want to clear the pool message? This will remove it from the homepage."
        )
      ) {
        this.clearMessage();
      }
    },

    clearMessage: async function () {
      const clearBtn = document.querySelector(
        "#section-pool-message.active #btnClearPoolMessage"
      );

      // Disable button
      if (clearBtn) {
        clearBtn.disabled = true;
        clearBtn.innerHTML =
          '<i class="fas fa-spinner fa-spin"></i> Clearing...';
      }

      try {
        const response = await AdminAPI.request("pool_message", {
          action: "delete",
        });

        if (response && response.result === "success") {
          this.showMessage(
            response.message || "Pool message cleared successfully",
            "success"
          );

          // Update current message to null
          this.currentMessage = null;

          // Immediately clear form and display
          this.populateForm(null);
          this.displayCurrentMessage(null);
          this.updatePreview();
        } else if (response && response.error) {
          this.showMessage(response.error, "error");
        }
      } catch (error) {
        console.error("Clear pool message error:", error);
        this.showMessage("Failed to clear message: " + error.message, "error");
      } finally {
        // Re-enable button
        if (clearBtn) {
          clearBtn.disabled = false;
          clearBtn.innerHTML = '<i class="fas fa-trash"></i> Clear Message';
        }
      }
    },

    showMessage: function (message, type = "success") {
      // Use specific selector to target only the active section
      const statusDiv = document.querySelector(
        "#section-pool-message.active #poolMessageStatus"
      );
      if (!statusDiv) return;

      statusDiv.style.display = "block";
      statusDiv.style.padding = "0.75rem 1rem";
      statusDiv.style.borderRadius = "0.375rem";

      if (type === "success") {
        statusDiv.style.background = "rgba(16, 185, 129, 0.1)";
        statusDiv.style.border = "1px solid rgba(16, 185, 129, 0.3)";
        statusDiv.style.color = "var(--success)";
        statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> ' + message;
      } else {
        statusDiv.style.background = "rgba(239, 68, 68, 0.1)";
        statusDiv.style.border = "1px solid rgba(239, 68, 68, 0.3)";
        statusDiv.style.color = "var(--danger)";
        statusDiv.innerHTML =
          '<i class="fas fa-exclamation-circle"></i> ' + message;
      }

      // Auto-hide after 5 seconds
      setTimeout(() => {
        statusDiv.style.display = "none";
      }, 5000);
    },

    capitalizeFirst: function (str) {
      if (!str) return "";
      return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    },

    formatDate: function (timestamp) {
      if (!timestamp) return "N/A";
      const date = new Date(timestamp);
      return date.toLocaleString();
    },
  };

  // Initialize on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  async function init() {
    AdminState.init();
    AdminUI.init();

    // Try auto-login if we have saved session credentials
    if (AdminState.sessionId && AdminState.token) {
      // Verify session is still valid by attempting to load pools
      try {
        await AdminAPI.request("pools");
        // Session is valid, show dashboard
        AdminState.isAuthenticated = true;
        AdminUI.showDashboard();
        await AdminAPI.loadOverview();
      } catch (error) {
        // Session invalid or expired, clear and show login
        AdminState.clearSession();
        AdminUI.showLogin();
      }
    } else {
      AdminUI.showLogin();
    }
  }

  // Security: Clear sensitive data on page unload
  window.addEventListener("beforeunload", () => {
    // Clear session tokens from memory if not remembered
    if (!SecureCookies.hasItem("adminSessionId")) {
      AdminState.sessionId = null;
      AdminState.token = null;
    }
  });
})();
