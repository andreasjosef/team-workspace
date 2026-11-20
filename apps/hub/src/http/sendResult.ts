import type { ErrorCode, Result } from '@app/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

const statusFor: Record<ErrorCode, number> = {
  invalid: 400,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  unavailable: 503,
  unexpected: 500,
};

export const GENERIC_MESSAGE = 'Something went wrong';

// The one place a Result becomes an HTTP response.
export const sendResult = <T>(
  request: FastifyRequest,
  reply: FastifyReply,
  result: Result<T>,
  status = 200
) => {
  if (result.success) return reply.status(status).send(result.value);
  if (result.code === 'unexpected') {
    request.log.error({ failure: result }, 'unexpected failure');
    return reply.status(500).send({
      code: 'unexpected',
      message: GENERIC_MESSAGE,
      requestId: request.id,
    });
  }
  return reply
    .status(statusFor[result.code])
    .send({ code: result.code, message: result.message });
};
