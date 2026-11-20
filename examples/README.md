# examples

Sample **Java Spring Boot** apps for trying [Cedar](https://github.com/somayaj/cedar) architectural micro-PR reviews.

| App | Layer | Purpose |
|-----|--------|---------|
| `payment-gateway` | API + integrations | HTTP webhooks and payment intake |
| `notification-hub` | API + delivery | Outbound email/SMS notifications |

Each sample PR is split so Cedar can partition **API**, **domain**, and **infrastructure** slices.

```bash
mvn -q -pl payment-gateway spring-boot:run   # port 8081
mvn -q -pl notification-hub spring-boot:run # port 8082
```