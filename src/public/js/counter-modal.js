// Counter Modal Handler
document.addEventListener('DOMContentLoaded', () => {
  
  // Get modal elements
  const modal = document.getElementById('createCounterModal');
  if (!modal) {
    console.error('Modal element not found');
    return;
  }
  
  const nameInput = document.getElementById('counterName');
  const publicToggle = document.getElementById('publicToggle');
  const privateLabel = document.getElementById('privateLabel');
  const publicLabel = document.getElementById('publicLabel');
  const cancelBtn = document.getElementById('cancelCounterBtn');
  const createBtn = document.getElementById('createCounterBtn');
  
  // Function to open the modal
  function openModal() {
    modal.classList.remove('hidden');
    nameInput.value = '';
    publicToggle.checked = false;
    updateToggleStyle();
    
    // Focus the name input
    setTimeout(() => nameInput.focus(), 100);
  }
  
  // Function to close the modal
  function closeModal() {
    modal.classList.add('hidden');
  }
  
  // Function to update toggle styling
  function updateToggleStyle() {
    const toggleSlider = publicToggle.nextElementSibling;
    
    if (publicToggle.checked) {
      toggleSlider.classList.add('bg-blue-600');
      toggleSlider.querySelector('span').classList.add('translate-x-5');
      privateLabel.className = 'text-sm text-gray-400 mr-2';
      publicLabel.className = 'text-sm text-gray-400 ml-2 font-bold';
    } else {
      toggleSlider.classList.remove('bg-blue-600');
      toggleSlider.querySelector('span').classList.remove('translate-x-5');
      privateLabel.className = 'text-sm text-gray-400 mr-2 font-bold';
      publicLabel.className = 'text-sm text-gray-400 ml-2';
    }
  }
  
  // Function to create a counter
  function createCounter() {
    const name = nameInput.value.trim();
    if (!name) {
      alert('Please enter a counter name');
      return;
    }
    
    const isPublic = publicToggle.checked;
    
    // Send data to server
    fetch('/counters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': localStorage.getItem('increment_client_token') ? 
          `Bearer ${localStorage.getItem('increment_client_token')}` : ''
      },
      body: JSON.stringify({
        name,
        public: isPublic
      })
    })
    .then(response => {
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      return response.json();
    })
    .then(data => {
      closeModal();
      
      // Refresh the counters list to show the newly created counter
      if (window.fetchCounters) {
        window.fetchCounters();
      }
    })
    .catch(error => {
      console.error('Error creating counter:', error);
      alert('Failed to create counter');
    });
  }
  
  // Set up event listeners
  if (publicToggle) {
    publicToggle.addEventListener('change', updateToggleStyle);
  }
  
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeModal);
  }
  
  if (createBtn) {
    createBtn.addEventListener('click', createCounter);
  } else {
    console.error('Create button not found');
  }
  
  // Close modal when clicking outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
  
  // Close modal with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });
  
  // Expose the openModal function globally
  window.counterModal = {
    open: openModal,
    close: closeModal
  };
}); 