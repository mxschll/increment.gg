// Share Counter Modal Handler
document.addEventListener("DOMContentLoaded", () => {
  // Get modal elements
  const modal = document.getElementById("shareCounterModal");
  const modalTitle = document.getElementById("shareModalTitle");
  const modalContent = document.getElementById("shareModalContent");
  const loadingIndicator = document.getElementById("loadingIndicator");
  const shareUrlContainer = document.getElementById("shareUrlContainer");
  const copyButton = document.getElementById("copyShareLinkBtn");
  const closeButton = document.getElementById("closeShareModalBtn");

  // Hidden input for iOS compatibility
  const hiddenInput = document.createElement("input");
  hiddenInput.setAttribute("readonly", "readonly");
  hiddenInput.setAttribute("aria-hidden", "true");
  hiddenInput.style.position = "absolute";
  hiddenInput.style.left = "-9999px";
  hiddenInput.style.opacity = "0";
  modalContent.appendChild(hiddenInput);

  // Function to open the share modal
  function openShareModal(id, name) {
    // Set modal title
    modalTitle.textContent = `Share "${name}" counter`;

    // Reset modal content
    loadingIndicator.classList.remove("hidden");
    shareUrlContainer.classList.add("hidden");
    copyButton.classList.add("hidden");

    // Show modal
    modal.classList.remove("hidden");

    // Request share token from server
    fetch(`/counters/${id}/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to share counter: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        // Hide loading indicator
        loadingIndicator.classList.add("hidden");

        // Create share URL
        const shareUrl = `${window.location.origin}/join/${data.token}`;

        // Set URL in container and show it
        shareUrlContainer.textContent = shareUrl;
        shareUrlContainer.classList.remove("hidden");

        // Show copy button
        copyButton.classList.remove("hidden");

        // Set hidden input value for iOS
        hiddenInput.value = shareUrl;

        // Set up copy button
        copyButton.onclick = () => {
          // Show "Copied!" confirmation
          showCopiedConfirmation();

          // Detect iOS
          const isIOS =
            /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

          if (isIOS) {
            // Make the shareUrlContainer selectable
            shareUrlContainer.setAttribute("contenteditable", "true");
            shareUrlContainer.focus();
            
            // Select the text in the container
            const range = document.createRange();
            range.selectNodeContents(shareUrlContainer);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            
            // Show copy instruction for iOS
            const copyMsg = document.createElement("div");
            copyMsg.className = "text-yellow-400 text-sm mt-2";
            copyMsg.textContent = 'Tap and hold to copy, then tap "Copy"';
            modalContent.appendChild(copyMsg);

            // Remove the contenteditable and clean up after copy or timeout
            const cleanup = () => {
              shareUrlContainer.removeAttribute("contenteditable");
              if (modalContent.contains(copyMsg)) {
                modalContent.removeChild(copyMsg);
              }
            };

            // Add a copy event listener to detect when text is copied
            document.addEventListener("copy", function onCopy() {
              document.removeEventListener("copy", onCopy);
              cleanup();
            });

            // Cleanup after 5 seconds if not copied
            setTimeout(cleanup, 5000);

            // Try to use the clipboard API anyway as a fallback
            try {
              navigator.clipboard.writeText(shareUrl);
            } catch (err) {
              console.error("Failed to copy: ", err);
            }
          } else {
            // Non-iOS devices - try modern clipboard API first
            navigator.clipboard.writeText(shareUrl).catch((err) => {
              console.error("Failed to copy: ", err);
              // Fallback for older browsers
              const textarea = document.createElement("textarea");
              textarea.value = shareUrl;
              textarea.style.position = "fixed";
              document.body.appendChild(textarea);
              textarea.focus();
              textarea.select();
              try {
                document.execCommand("copy");
              } catch (err) {
                console.error("Fallback: Could not copy text: ", err);
              }
              document.body.removeChild(textarea);
            });
          }
        };
      })
      .catch((error) => {
        console.error("Error sharing counter:", error);
        loadingIndicator.classList.add("hidden");

        const errorMessage = document.createElement("div");
        errorMessage.className = "text-red-400 py-2";
        errorMessage.textContent =
          "Failed to generate share link. Please try again.";

        const retryButton = document.createElement("button");
        retryButton.className =
          "bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded w-full mt-4 transition-colors";
        retryButton.textContent = "Try Again";
        retryButton.onclick = () => {
          openShareModal(id, name);
        };

        // Clear existing content
        while (modalContent.firstChild) {
          if (modalContent.firstChild !== hiddenInput) {
            modalContent.removeChild(modalContent.firstChild);
          }
        }

        modalContent.appendChild(errorMessage);
        modalContent.appendChild(retryButton);
      });
  }

  // Function to close the modal
  function closeShareModal() {
    modal.classList.add("hidden");
  }

  // Function to show "Copied!" confirmation
  function showCopiedConfirmation() {
    copyButton.textContent = "Copied!";
    copyButton.className =
      "bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded w-full transition-colors";

    setTimeout(() => {
      copyButton.textContent = "Copy Link";
      copyButton.className =
        "bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded w-full transition-colors";
    }, 2000);
  }

  // Close modal when clicking outside
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeShareModal();
    }
  });

  closeButton.addEventListener("click", closeShareModal);

  // Close modal with Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      closeShareModal();
    }
  });

  // Expose the openShareModal function globally
  window.shareModal = {
    open: openShareModal,
    close: closeShareModal,
  };
});
