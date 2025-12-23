// API Configuration
// Update this with your actual API endpoint
const CONFIG = {
  API_URL: 'http://localhost:8080/offers'
};

// Make it available to other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
