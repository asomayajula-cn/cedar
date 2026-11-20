package com.somayaj.cedar.payment.api.dto;

import jakarta.validation.constraints.NotBlank;

public record WebhookEventRequest(
    @NotBlank String eventId,
    @NotBlank String type,
    String payloadJson
) {}