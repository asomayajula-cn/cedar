package com.somayaj.cedar.payment.api;

import com.somayaj.cedar.payment.api.dto.WebhookEventRequest;
import com.somayaj.cedar.payment.domain.WebhookVerifier;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/webhooks")
public class WebhookController {

  private final WebhookVerifier verifier;

  public WebhookController(WebhookVerifier verifier) {
    this.verifier = verifier;
  }

  @PostMapping("/stripe")
  public ResponseEntity<Map<String, String>> stripe(
      @RequestHeader(value = "Stripe-Signature", required = false) String signature,
      @Valid @RequestBody WebhookEventRequest body
  ) {
    if (!verifier.verifySignature(signature, body.payloadJson())) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
          .body(Map.of("status", "rejected", "reason", "invalid_signature"));
    }
  return ResponseEntity.accepted()
        .body(Map.of(
            "status", "accepted",
            "event", verifier.summarizeEvent(body.type(), body.eventId())
        ));
  }
}