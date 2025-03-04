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
    // Re-subscribe to appropriate room to get latest counter states
    if (isPrivatePage) {
      socket.emit("subscribe", "private");
    } else {
      socket.emit("subscribe", "public");
    }
  }

  // Function to handle fetch errors and suppress 401 errors in console
  function handleFetchError(error, operation) {
    // Suppress 401 errors in the console
    if (!error.message || !error.message.includes("401")) {
      console.error(`Error during ${operation}:`, error);
    }
  }

  // Socket connection event handlers
  socket.on("connect", () => {
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
      socket.emit("subscribe", "private");
    } else {
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
    statusIndicator.className =
      "fixed top-2 right-2 p-2 rounded-full text-red-600 transition-all duration-300";
    statusIndicator.textContent = "●";
    statusIndicator.classList.remove("hidden", "opacity-0");
  });

  socket.on("reconnecting", (attemptNumber) => {
    statusIndicator.className =
      "fixed top-2 right-2 p-2 rounded-full text-yellow-600 transition-all duration-300";
    statusIndicator.textContent = "●";
    statusIndicator.classList.remove("hidden", "opacity-0");
  });

  socket.on("reconnect", () => {
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

    // Add share button
    const share_button = document.createElement("button");
    share_button.className =
      "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent h-10 w-10 text-amber-600 hover:text-amber-700";
    share_button.onclick = () => shareCounter(id, name);

    // Create SVG for share button
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("xmlns", svgNS);
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("class", "lucide lucide-share2 h-4 w-4");

    // Add circles and lines to the SVG
    const circle1 = document.createElementNS(svgNS, "circle");
    circle1.setAttribute("cx", "18");
    circle1.setAttribute("cy", "5");
    circle1.setAttribute("r", "3");
    svg.appendChild(circle1);

    const circle2 = document.createElementNS(svgNS, "circle");
    circle2.setAttribute("cx", "6");
    circle2.setAttribute("cy", "12");
    circle2.setAttribute("r", "3");
    svg.appendChild(circle2);

    const circle3 = document.createElementNS(svgNS, "circle");
    circle3.setAttribute("cx", "18");
    circle3.setAttribute("cy", "19");
    circle3.setAttribute("r", "3");
    svg.appendChild(circle3);

    const line1 = document.createElementNS(svgNS, "line");
    line1.setAttribute("x1", "8.59");
    line1.setAttribute("x2", "15.42");
    line1.setAttribute("y1", "13.51");
    line1.setAttribute("y2", "17.49");
    svg.appendChild(line1);

    const line2 = document.createElementNS(svgNS, "line");
    line2.setAttribute("x1", "15.41");
    line2.setAttribute("x2", "8.59");
    line2.setAttribute("y1", "6.51");
    line2.setAttribute("y2", "10.49");
    svg.appendChild(line2);

    share_button.appendChild(svg);
    button_container.appendChild(share_button);

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
    // Handle initial counter sync for private counters
    socket.on("private:counters:sync", (counters) => {
      // Clear existing counters
      counters_list.innerHTML = "";
      // Add all counters
      counters.forEach((counter) => {
        addCounterItem(counter.id, counter.name, counter.value);
      });
    });

    // Handle updates to private counters
    socket.on("private:update", (counter) => {
      const li = document.getElementById(counter.id);
      if (li) {
        li.querySelector(".value").textContent = ` ${counter.value}`;
      } else {
        addCounterItem(counter.id, counter.name, counter.value);
      }
    });

    // Handle new private counters
    socket.on("private:new", (counter) => {
      addCounterItem(counter.id, counter.name, counter.value);
    });
  } else {
    // Handle initial counter sync for public counters
    socket.on("counters:sync", (counters) => {
      // Clear existing counters
      counters_list.innerHTML = "";
      // Add all counters
      counters.forEach((counter) => {
        addCounterItem(counter.id, counter.name, counter.value);
      });
    });

    // Handle updates to public counters
    socket.on("update", (counter) => {
      const li = document.getElementById(counter.id);
      if (li) {
        li.querySelector(".value").textContent = ` ${counter.value}`;
      } else {
        addCounterItem(counter.id, counter.name, counter.value);
      }
    });

    // Handle new public counters
    socket.on("new", (counter) => {
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
