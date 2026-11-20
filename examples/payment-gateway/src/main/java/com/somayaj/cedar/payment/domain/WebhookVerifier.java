package com.somayaj.cedar.payment.domain;

import org.springframework.stereotype.Service;

@Service
public class WebhookVerifier {

  public boolean verifySignature(String signatureHeader, String rawBody) {
    if (signatureHeader == null || signatureHeader.isBlank()) {
      return false;
    }
    return signatureHeader.startsWith("sha256=") && rawBody != null;
  }

  public String summarizeEvent(String type, String eventId) {
    return type + "#" + eventId;
  }
}