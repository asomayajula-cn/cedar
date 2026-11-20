# examples

Spring Boot **bounded contexts** structured for Cedar reviews using the same model as PR architecture:

**DDD · SOLID · 12-factor**

| App | Context | Port |
|-----|---------|------|
| `payment-gateway` | Payments | `${PORT:8081}` |
| `notification-hub` | Notifications | `${PORT:8082}` |

## DDD packages

```
domain/           # Entities, value objects, domain services (no Spring)
application/      # Use cases, ports, application services (DIP)
infrastructure/   # Adapters, @Configuration, outbound integrations
api/              # Driving adapters — REST, request DTOs (thin SRP)
```

Dependency rule: **api → application → domain**. Infrastructure implements ports; domain never imports Spring.

## SOLID (what Cedar checks)

| Principle | In these examples |
|-----------|-------------------|
| SRP | Controllers only HTTP; rules live in application/domain |
| OCP | Extend via new types/services, not growing controllers |
| LSP | Infrastructure adapters honor application contracts |
| ISP | Small ports under `application` when you add integrations |
| DIP | `@Bean` wiring in `infrastructure.config`; domain stays pure |

## 12-factor

| Factor | Practice here |
|--------|----------------|
| III Config | `application.yml` uses `${ENV:default}`; no secrets in repo |
| VII Port binding | `server.port: ${PORT:8081}` |
| IX Disposability | Stateless services, actuator health on `/api/health` |
| X Dev/prod parity | Same jar; config via environment |

## Run

```bash
mvn -q -pl payment-gateway spring-boot:run
mvn -q -pl notification-hub spring-boot:run
```

Cedar maps paths to micro-slices via root [`components.yaml`](../components.yaml).