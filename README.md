# Increment.gg

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
