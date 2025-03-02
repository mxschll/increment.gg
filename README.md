# Increment.gg

A simple counter application that allows users to create and share counters.

## Development Setup

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/increment.gg.git
   cd increment.gg
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Build the assets:
   ```
   npm run build
   ```

4. Start the development server:
   ```
   npm run dev:all
   ```

5. Open your browser and navigate to `http://localhost:3000`

## Production Deployment

### Using Docker (Recommended)

1. Make sure you have Docker and Docker Compose installed.

2. Build and start the containers:
   ```
   docker-compose up -d
   ```

3. The application will be available at `http://localhost:3000`

### Manual Deployment

1. Install dependencies:
   ```
   npm install --production
   ```

2. Build the assets:
   ```
   npm run build
   ```

3. Start the server:
   ```
   npm start
   ```

## Project Structure

- `src/public/js/` - Client-side JavaScript files
- `src/public/css/` - CSS files
- `src/views/` - Pug templates
- `src/` - Server-side code

## Building and Bundling

- JavaScript files are bundled using Laravel Mix (Webpack)
- CSS is processed using Tailwind CSS

To build the JavaScript bundle:
```
npm run build:js
```

To build the CSS:
```
npm run tailwind
```

To build both:
```
npm run build
```

## License

ISC

## API

**POST /counters**

Create a new counter with the given name. A counter can be public or private.

```bash
curl -X POST -H "Content-Type: application/json" -d '{"name": "myCounter", "public": true}' http://increment.gg/counter
```

**GET /counters**

Get a list of public counters.

```bash
curl http://increment.gg/counters
```

**POST /counters/:id/increment**

Increment the counter with the given id.

```bash
curl -X POST http://increment.gg/counters/1/increment
```
