import { describe, it, expect } from 'vitest';
import { DECORATORS } from '@nestjs/swagger';
import { ApplicantReviewController } from './applicant-review.controller';
import {
  AdmissionApplicantResponseDto,
  ApplicantListResponseDto,
} from './dto/applicant-list-response.dto';

describe('ApplicantReviewController OpenAPI (#3019)', () => {
  it('documents the 200 body of GET /admission/applicants', () => {
    const responses = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      ApplicantReviewController.prototype.findAll,
    );

    expect(responses['200'].type).toBe(ApplicantListResponseDto);
  });

  it('documents data as an array of applicants', () => {
    const data = Reflect.getMetadata(
      DECORATORS.API_MODEL_PROPERTIES,
      ApplicantListResponseDto.prototype,
      'data',
    );

    expect(data).toMatchObject({ type: AdmissionApplicantResponseDto, isArray: true });
  });
});
