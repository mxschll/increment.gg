class AuthModal {
    constructor() {
        this.modal = document.getElementById('authModal');
        this.form = document.getElementById('authForm');
        this.titleEl = document.getElementById('authModalTitle');
        this.errorEl = document.getElementById('authError');
        this.submitBtn = document.getElementById('submitAuthBtn');
        this.toggleBtn = document.getElementById('toggleAuthModeBtn');
        this.closeBtn = document.getElementById('closeAuthModalBtn');
        this.authButton = document.getElementById('authButton');
        
        this.isLoginMode = true;
        this.setupEventListeners();
        this.checkAuthStatus();
    }

    setupEventListeners() {
        this.closeBtn.addEventListener('click', () => this.hide());
        this.toggleBtn.addEventListener('click', () => this.toggleMode());
        this.form.addEventListener('submit', (e) => this.handleSubmit(e));
        
        // Close on background click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.hide();
        });
    }

    async checkAuthStatus() {
        try {
            const response = await fetch('/auth/status');
            const data = await response.json();
            
            if (data.authenticated) {
                this.authButton.textContent = data.username;
                // Remove click handler and update appearance for logged in state
                this.authButton.removeEventListener('click', () => this.show());
                this.authButton.classList.add('opacity-50', 'cursor-default');
                this.authButton.classList.remove('hover:border-amber-300', 'hover:text-amber-900', 'hover:bg-amber-50');
            } else {
                this.authButton.textContent = 'login';
                // Ensure button is clickable and has hover effects
                this.authButton.addEventListener('click', () => this.show());
                this.authButton.classList.remove('opacity-50', 'cursor-default');
                this.authButton.classList.add('hover:border-amber-300', 'hover:text-amber-900', 'hover:bg-amber-50');
            }
        } catch (error) {
            console.error('Failed to check auth status:', error);
        }
    }

    show() {
        this.modal.classList.remove('hidden');
        this.errorEl.classList.add('hidden');
        this.form.reset();
    }

    hide() {
        this.modal.classList.add('hidden');
    }

    toggleMode() {
        this.isLoginMode = !this.isLoginMode;
        this.titleEl.textContent = this.isLoginMode ? 'Login' : 'Register';
        this.submitBtn.textContent = this.isLoginMode ? 'Login' : 'Register';
        this.toggleBtn.textContent = this.isLoginMode 
            ? "Don't have an account? Register"
            : 'Already have an account? Login';
        this.errorEl.classList.add('hidden');
    }

    showError(message) {
        this.errorEl.textContent = message;
        this.errorEl.classList.remove('hidden');
    }

    async handleSubmit(e) {
        e.preventDefault();
        
        const formData = new FormData(this.form);
        const data = {
            username: formData.get('username'),
            password: formData.get('password')
        };

        try {
            const response = await fetch(
                `/auth/${this.isLoginMode ? 'login' : 'register'}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                }
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
            await fetch('/auth/logout', { method: 'POST' });
            window.location.reload();
        } catch (error) {
            console.error('Failed to logout:', error);
        }
    }
}

// Initialize the auth modal
document.addEventListener('DOMContentLoaded', () => {
    window.authModal = new AuthModal();
}); 