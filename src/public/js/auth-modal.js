class AuthModal {
  constructor() {
    this.modal = document.getElementById("authModal");
    this.form = document.getElementById("authForm");
    this.titleEl = document.getElementById("authModalTitle");
    this.errorEl = document.getElementById("authError");
    this.submitBtn = document.getElementById("submitAuthBtn");
    this.toggleBtn = document.getElementById("toggleAuthModeBtn");
    this.closeBtn = document.getElementById("closeAuthModalBtn");

    this.isLoginMode = true;
    this.openBtn = document.getElementById("authButton");

    if (this.openBtn) {
      this.setupEventListeners();
    }
  }

  setupEventListeners() {
    this.openBtn.addEventListener("click", () => this.show());
    this.closeBtn.addEventListener("click", () => this.hide());
    this.toggleBtn.addEventListener("click", () => this.toggleMode());
    this.form.addEventListener("submit", (e) => this.handleSubmit(e));

    // Close on background click
    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) this.hide();
    });
  }

  show() {
    this.modal.classList.remove("hidden");
    this.errorEl.classList.add("hidden");
    this.form.reset();
  }

  hide() {
    this.modal.classList.add("hidden");
  }

  toggleMode() {
    this.isLoginMode = !this.isLoginMode;
    this.titleEl.textContent = this.isLoginMode ? "Login" : "Register";
    this.submitBtn.textContent = this.isLoginMode ? "Login" : "Register";
    this.toggleBtn.textContent = this.isLoginMode
      ? "Don't have an account? Register"
      : "Already have an account? Login";
    this.errorEl.classList.add("hidden");
  }

  showError(message) {
    this.errorEl.textContent = message;
    this.errorEl.classList.remove("hidden");
  }

  async handleSubmit(e) {
    e.preventDefault();

    const formData = new FormData(this.form);
    const data = {
      username: formData.get("username"),
      password: formData.get("password"),
    };

    try {
      const response = await fetch(
        `/auth/${this.isLoginMode ? "login" : "register"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error);
      }

      // Success - reload the page to update state
      window.location.reload();
    } catch (error) {
      this.showError(error.message);
    }
  }

  async handleLogout() {
    try {
      await fetch("/auth/logout", { method: "POST" });
      window.location.reload();
    } catch (error) {
      console.error("Failed to logout:", error);
    }
  }
}

// Initialize the auth modal
document.addEventListener("DOMContentLoaded", () => {
  window.authModal = new AuthModal();
});
