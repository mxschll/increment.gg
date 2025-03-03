// Unified client-side code for both public and private counter pages
(function () {
  // Determine page type based on URL path
  const isPrivatePage =
    window.location.pathname.includes("/private") ||
    window.location.pathname.includes("/join");

  // Create status indicator element
  const statusIndicator = document.createElement("div");
  statusIndicator.className =
    "fixed top-2 right-2 p-2 rounded-full transition-all duration-300 hidden z-50";
  document.body.appendChild(statusIndicator);

  // Configure socket with reconnection settings
  const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    // Cookies will be sent automatically with the socket connection
  });

  const counters_list = document.getElementById("counters");

  // Common function to prepare headers for API requests
  function getHeaders() {
    return {
      "Content-Type": "application/json",
      // No need to manually add Authorization header, cookies are sent automatically
    };
  }

  // Function to submit a join request
  function submitJoinRequest(joinId) {
    // Show loading state
    if (counters_list) {
      counters_list.innerHTML =
        '<li class="py-3 text-yellow-400">Joining counter...</li>';
    }

    // Submit join request to server
    fetch(`/counters/join/${joinId}`, {
      method: "POST",
      headers: getHeaders(),
      // Cookies will be sent automatically
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to join counter: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        window.location.href = "/private";
      })
      .catch((error) => {
        console.error("Error joining counter:", error);
        if (counters_list) {
          counters_list.innerHTML =
            '<li class="py-3 text-red-400">Failed to join counter. The link may be invalid or expired.</li>';
        }
      });
  }

  // Function to fetch counters (public or private based on page type)
  function fetchCounters() {
    const endpoint = isPrivatePage ? "/counters/private" : "/counters";

    // If we're on the private page, we need authentication
    if (isPrivatePage) {
      // Check if we're already authenticated by making the request
      // If we're not, the server will respond with a 401
      fetch("/auth/status")
        .then(response => {
          if (response.status === 401) {
            counters_list.innerHTML =
              '<li class="py-3 text-yellow-400">Authenticating...</li>';
            return;
          }
          loadCounters(endpoint);
        })
        .catch(() => {
          // On error, attempt to load counters anyway
          loadCounters(endpoint);
        });
    } else {
      // Public page doesn't need auth check
      loadCounters(endpoint);
    }
  }

  function loadCounters(endpoint) {
    fetch(endpoint, {
      method: "GET",
      headers: getHeaders(),
    })
      .then((response) => {
        if (!response.ok) {
          if (response.status === 401 && isPrivatePage) {
            counters_list.innerHTML =
              '<li class="py-3 text-yellow-400">Authenticating...</li>';
          }
          throw new Error(`Failed to fetch counters: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        const counters = data.counters || data;

        // If the list only contains an error/status message, clear it
        if (
          counters_list.children.length === 1 &&
          (counters_list.children[0].classList.contains("text-yellow-400") ||
           counters_list.children[0].classList.contains("text-red-400"))
        ) {
          counters_list.innerHTML = "";
        }

        counters.forEach((counter) => {
          const existingCounter = document.getElementById(counter.id);
          if (existingCounter) {
            // Update existing counter value
            const valueSpan = existingCounter.querySelector(".value");
            if (valueSpan) {
              valueSpan.textContent = ` ${counter.value}`;
            }
          } else {
            // Add new counter to the list
            addCounterItem(counter.id, counter.name, counter.value);
          }
        });
      })
      .catch((error) => {
        console.error("Error fetching counters:", error);
        // Only show error if list is empty
        if (!counters_list.children.length) {
          counters_list.innerHTML =
            '<li class="py-3 text-red-400">Failed to load counters. Please check your authentication.</li>';
        }
      });
  }

  // Listen for registration complete event
  window.addEventListener(window.REGISTRATION_COMPLETE_EVENT, () => {
    // If we're on the private page, fetch counters again
    if (isPrivatePage) {
      fetchCounters();

      // If using sockets, reconnect 
      if (socket) {
        socket.disconnect();
        socket.connect();
      }
    }
  });

  // Function to handle fetch errors and suppress 401 errors in console
  function handleFetchError(error, operation) {
    // Suppress 401 errors in the console
    if (!error.message || !error.message.includes("401")) {
      console.error(`Error during ${operation}:`, error);
    }
  }

  // Socket connection event handlers
  socket.on("connect", () => {
    console.log("Socket connected");
    statusIndicator.className =
      "fixed top-2 right-2 p-2 rounded-full transition-all duration-300 text-green-600";
    statusIndicator.textContent = "●";
    statusIndicator.classList.remove("hidden", "opacity-0");

    // Hide the indicator after 3 seconds
    setTimeout(() => {
      statusIndicator.classList.add("opacity-0");
      setTimeout(() => statusIndicator.classList.add("hidden"), 300);
    }, 3000);

    // Subscribe to appropriate room based on page type
    if (isPrivatePage) {
      console.log("Subscribing to private room");
      socket.emit("subscribe", "private");
    } else {
      console.log("Subscribing to public");
      socket.emit("subscribe", "public");
    }
  });

  socket.on("connect_error", (error) => {
    console.error("Socket connection error:", error);
    statusIndicator.className =
      "fixed top-2 right-2 p-2 rounded-full text-red-600 transition-all duration-300";
    statusIndicator.textContent = "●";
    statusIndicator.classList.remove("hidden", "opacity-0");
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", reason);
    statusIndicator.className =
      "fixed top-2 right-2 p-2 rounded-full text-red-600 transition-all duration-300";
    statusIndicator.textContent = "●";
    statusIndicator.classList.remove("hidden", "opacity-0");
  });

  socket.on("reconnecting", (attemptNumber) => {
    console.log("Socket reconnecting, attempt:", attemptNumber);
    statusIndicator.className =
      "fixed top-2 right-2 p-2 rounded-full text-yellow-600 transition-all duration-300";
    statusIndicator.textContent = "●";
    statusIndicator.classList.remove("hidden", "opacity-0");
  });

  socket.on("reconnect", () => {
    console.log("Socket reconnected");
    statusIndicator.className =
      "fixed top-2 right-2 p-2 rounded-full text-green-600 transition-all duration-300";
    statusIndicator.textContent = "●";

    // Refresh data when reconnected
    fetchCounters();

    // Hide the indicator after 3 seconds
    setTimeout(() => {
      statusIndicator.classList.add("opacity-0");
      setTimeout(() => statusIndicator.classList.add("hidden"), 300);
    }, 3000);
  });

  socket.on("reconnect_error", (error) => {
    console.error("Socket reconnect error:", error);
    statusIndicator.className =
      "fixed top-2 right-2 p-2 rounded-full text-red-600 transition-all duration-300";
    statusIndicator.textContent = "●";
    statusIndicator.classList.remove("hidden", "opacity-0");
  });

  function incr(id) {
    const li = document.getElementById(id);
    if (li) {
      const valueSpan = li.querySelector(".value");
      let currentValue = parseInt(valueSpan.textContent.trim());
      valueSpan.textContent = ` ${currentValue + 1}`;

      fetch(`/counters/${id}/increment`, {
        method: "POST",
        headers: getHeaders(),
      })
        .then((response) => {
          if (response.status === 401) {
            // Handle unauthorized errors
            if (window.handleTokenInvalidation) {
              window.handleTokenInvalidation();
            }
          }
          return response;
        })
        .catch((error) => {
          // Use the error handler to suppress 401 errors
          handleFetchError(error, "counter increment");
        });
    }
  }

  // Function to share a counter
  function shareCounter(id, name) {
    if (window.shareModal) {
      window.shareModal.open(id, name);
    } else {
      console.error("Share modal not found");
    }
  }

  window.shareCounter = shareCounter;

  function addCounterItem(id, name, value) {
    const li = document.createElement("li");
    li.id = id;
    li.className =
      "flex flex-row justify-between items-center p-3 bg-amber-50 rounded-lg border border-amber-200 transition-all hover_border-amber-300";

    const name_span = document.createElement("span");
    name_span.textContent = name;
    name_span.className = "text-amber-900 truncate mr-4 max-w-[60%]";
    li.appendChild(name_span);

    const button_container = document.createElement("div");
    button_container.className = "flex items-center space-x-2";
    li.appendChild(button_container);

    const increment_button = document.createElement("button");
    increment_button.className =
      "px-3 py-1 bg-amber-100 text-amber-800 rounded-md min-w-[3.5rem] text-center font-medium focus_outline-none focus_ring-2 focus_ring-amber-500 focus_bg-amber-200 hover_bg-amber-200 transition-colors";
    increment_button.onclick = () => incr(id);
    button_container.appendChild(increment_button);

    const counter_value = document.createElement("span");
    counter_value.className = "value";
    counter_value.textContent = `${value}`;
    increment_button.appendChild(counter_value);

    // Replace text node with bold span element
    const incrementText = document.createElement("span");
    incrementText.textContent = "++";
    increment_button.appendChild(incrementText);

    counters_list.appendChild(li);
  }

  // Add visibility change handler to monitor when tab is in background
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      // Page is now visible - check connection status
      if (!socket.connected) {
        socket.connect();
      } else {
        // Even if connected, refresh data to make sure it's current
        fetchCounters();
      }
    }
  });

  // Set up event handlers based on page type
  if (isPrivatePage) {
    fetchCounters();

    // Handle updates to private counters
    socket.on("private:update", (counter) => {
      console.log("Received private:update event", counter);
      const li = document.getElementById(counter.id);
      if (li) {
        li.querySelector(".value").textContent = ` ${counter.value}`;
      } else {
        addCounterItem(counter.id, counter.name, counter.value);
      }
    });

    // Handle new private counters
    socket.on("private:new", (counter) => {
      console.log("Received private:new event", counter);
      addCounterItem(counter.id, counter.name, counter.value);
    });
  } else {
    // Load public counters
    fetchCounters();

    // Handle updates to public counters
    socket.on("update", (counter) => {
      console.log("Received update event", counter);
      const li = document.getElementById(counter.id);
      if (li) {
        li.querySelector(".value").textContent = ` ${counter.value}`;
      } else {
        addCounterItem(counter.id, counter.name, counter.value);
      }
    });

    // Handle new public counters
    socket.on("new", (counter) => {
      console.log("Received new event", counter);
      addCounterItem(counter.id, counter.name, counter.value);
    });
  }

  // Add event listeners to existing increment buttons
  document.querySelectorAll("button").forEach((button) => {
    const id = button.getAttribute("data-id");
    if (id) {
      button.addEventListener("click", () => {
        incr(id);
      });
    }
  });

  // Make fetchCounters available globally
  window.fetchCounters = fetchCounters;
})();
