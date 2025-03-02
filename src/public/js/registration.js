// Client registration handler
(function () {
  // Constants for localStorage keys
  const CLIENT_TOKEN_KEY = 'increment_client_token';
  const CLIENT_ID_KEY = 'increment_client_id';

  // Event to notify when registration is complete
  const REGISTRATION_COMPLETE_EVENT = 'registration:complete';

  // Function to register a new client
  async function registerClient() {
    try {
      const storedToken = localStorage.getItem(CLIENT_TOKEN_KEY);
      const storedClientId = localStorage.getItem(CLIENT_ID_KEY);

      // Check auth status
      const authStatus = await fetch('/auth/status', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${storedToken}`
        }
      });

      const authData = await authStatus.json();

      if (!authData.authenticated) {
        localStorage.removeItem(CLIENT_TOKEN_KEY);
        localStorage.removeItem(CLIENT_ID_KEY);

        fetch('/auth/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ token: storedToken, clientId: storedClientId })
        }).then(response => {
          if (response.ok) {
            return response.json();
          }
          return null;
        }).then(data => {
          if (data) {
            localStorage.setItem(CLIENT_TOKEN_KEY, data.token);
            localStorage.setItem(CLIENT_ID_KEY, data.clientId);

            // Dispatch event to notify registration is complete
            window.dispatchEvent(new CustomEvent(REGISTRATION_COMPLETE_EVENT, {
              detail: {
                token: data.token,
                clientId: data.clientId,
                isNewRegistration: true
              }
            }));

            console.log('Client registered successfully');
          }
        }).catch(error => {
          console.error('Registration error:', error);
        });

      } else {
        console.log('Using existing client credentials');

        // Dispatch an event to notify that we're using existing credentials
        window.dispatchEvent(new CustomEvent(REGISTRATION_COMPLETE_EVENT, {
          detail: {
            token: storedToken,
            clientId: storedClientId,
            isNewRegistration: false
          }
        }));

        return;
      }
    } catch (error) {
      console.error('Error in registration process:', error);
    }
  }

  // Function to attach authorization headers to fetch requests
  function attachTokenToFetch() {
    const originalFetch = window.fetch;

    window.fetch = function (url, options = {}) {
      // Get client token (always get the latest)
      const token = localStorage.getItem(CLIENT_TOKEN_KEY);

      if (token) {
        // Create headers if not exist
        if (!options.headers) {
          options.headers = {};
        }

        // Add Authorization header with token
        if (options.headers instanceof Headers) {
          options.headers.append('Authorization', `Bearer ${token}`);
        } else {
          options.headers['Authorization'] = `Bearer ${token}`;
        }
      }

      // Call original fetch with modified options
      return originalFetch.call(this, url, options);
    };
  }

  // Initialize the client
  function init() {
    registerClient();
  }

  // Register client on page load
  document.addEventListener('DOMContentLoaded', init);
  window.REGISTRATION_COMPLETE_EVENT = REGISTRATION_COMPLETE_EVENT;

})(); 