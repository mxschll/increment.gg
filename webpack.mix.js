const mix = require('laravel-mix');

// Set the public path
mix.setPublicPath('src/public');

// Bundle JavaScript files
mix.js('src/public/js/app.js', 'dist'); 