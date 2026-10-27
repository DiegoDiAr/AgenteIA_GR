export class AppError extends Error {
  constructor(message, status = 502, code = 'upstream_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Solo se registran identificadores conocidos; nunca mensajes, URL, cabeceras o cuerpos.
const exceptionNames = new Set(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'AggregateError', 'TimeoutError', 'AbortError', 'InvalidArgumentError']);
const technicalCodes = new Set([
  'EACCES', 'EPERM', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_INVALID_ARG',
  'ERR_INVALID_URL', 'ERR_INVALID_CHAR', 'ERR_HTTP_INVALID_HEADER_VALUE', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER',
]);
const providerTypes = new Set(['invalid_request_error', 'authentication_error', 'permission_error', 'rate_limit_error', 'insufficient_quota', 'server_error']);
const providerCodes = new Set(['invalid_api_key', 'insufficient_permissions', 'insufficient_quota', 'billing_hard_limit_reached', 'model_not_found', 'rate_limit_exceeded', 'slow_down', 'invalid_value', 'invalid_json', 'invalid_type', 'invalid_parameter', 'missing_required_parameter', 'unsupported_parameter', 'context_length_exceeded', 'invalid_request_error']);

function technicalCause(error) {
  const pending = [error], visited = new Set(), codes = new Set();
  while (pending.length && visited.size < 20) {
    const item = pending.shift();
    if (!item || typeof item !== 'object' || visited.has(item)) continue;
    visited.add(item);
    if (technicalCodes.has(item.code)) codes.add(item.code);
    if (item.cause) pending.push(item.cause);
    if (Array.isArray(item.errors)) pending.push(...item.errors.slice(0, 10));
  }
  return { exceptionType: exceptionNames.has(error?.name) ? error.name : 'unknown', causeCodes: [...codes] };
}

function openAIError(message, code, started, response, phase, error, provider = {}, status = 502) {
  const diagnostics = {
    service: 'OpenAI', phase, httpStatus: response?.status ?? null,
    elapsedMs: Math.max(0, Math.round(performance.now() - started)),
    ...technicalCause(error),
    providerType: providerTypes.has(provider?.type) ? provider.type : null,
    providerCode: providerCodes.has(provider?.code) ? provider.code : null,
  };
  const result = new AppError(message, status, code);
  result.diagnostics = diagnostics;
  console.error(JSON.stringify({ event: 'openai_request_failed', code, ...diagnostics }));
  return result;
}

function openAITransportError(error, started, response, phase) {
  const { causeCodes, exceptionType } = technicalCause(error);
  const has = (...codes) => codes.some(code => causeCodes.includes(code));
  let message = 'La solicitud a OpenAI falló. Revisa el diagnóstico técnico del servidor.', code = 'openai_transport_error', status = 502;
  if (exceptionType === 'TimeoutError' || has('ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT')) {
    message = 'La solicitud a OpenAI agotó su tiempo de espera. Intenta nuevamente.'; code = 'openai_timeout'; status = 504;
  } else if (exceptionType === 'AbortError') {
    message = 'La solicitud a OpenAI fue cancelada.'; code = 'openai_aborted';
  } else if (has('EACCES', 'EPERM')) {
    message = 'El entorno del servidor denegó la conexión de red con OpenAI.'; code = 'openai_network_denied';
  } else if (has('ENOTFOUND', 'EAI_AGAIN')) {
    message = 'El servidor no pudo resolver el dominio de OpenAI. Revisa DNS y conexión.'; code = 'openai_dns_error';
  } else if (causeCodes.some(value => /CERT|SSL|TLS|SELF_SIGNED/.test(value))) {
    message = 'No se pudo establecer una conexión TLS válida con OpenAI. Revisa los certificados del entorno.'; code = 'openai_tls_error';
  } else if (has('ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET')) {
    message = 'La conexión con OpenAI falló o se interrumpió. Revisa la red del servidor.'; code = 'openai_connection_error';
  } else if (has('ERR_INVALID_URL', 'ERR_INVALID_CHAR', 'ERR_HTTP_INVALID_HEADER_VALUE', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'UND_ERR_INVALID_ARG')) {
    message = 'El cliente HTTP no pudo construir la solicitud a OpenAI. Revisa la configuración del backend.'; code = 'openai_request_error';
  }
  return openAIError(message, code, started, response, phase, error, {}, status);
}

export async function fetchJson(fetchImpl, url, options, service) {
  const started = performance.now();
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(service === 'OpenAI' ? 60000 : 20000), redirect: 'error' });
  } catch (error) {
    if (service === 'OpenAI') throw openAITransportError(error, started, null, 'request');
    throw new AppError(`${service} no respondió a tiempo o no está disponible. Intenta nuevamente.`, 502, 'service_unavailable');
  }
  if (!response.ok) {
    if (service === 'OpenAI') {
      let provider = {}, bodyError;
      try { provider = (await response.json())?.error || {}; } catch (error) { bodyError = error; }
      let message = `OpenAI devolvió HTTP ${response.status}. Intenta nuevamente.`, code = 'upstream_error', status = 502;
      if (response.status === 401) { message = 'OpenAI rechazó la autenticación (HTTP 401). Revisa la clave del backend.'; code = 'invalid_credentials'; status = 503; }
      else if (response.status === 403) { message = 'OpenAI rechazó el acceso (HTTP 403). Revisa los permisos del proyecto y del modelo.'; code = 'openai_permission_error'; status = 503; }
      else if (provider.code === 'model_not_found' && [400, 404].includes(response.status)) { message = `OpenAI no encontró el modelo configurado o la cuenta no tiene acceso (HTTP ${response.status}).`; code = 'openai_model_error'; }
      else if (response.status === 404) { message = 'OpenAI no encontró el recurso solicitado (HTTP 404).'; code = 'not_found'; }
      else if (response.status === 400 || response.status === 422) { message = `OpenAI rechazó el formato o los parámetros de la solicitud (HTTP ${response.status}).`; code = 'openai_invalid_request'; }
      else if (response.status === 429) {
        const quota = ['insufficient_quota', 'billing_hard_limit_reached'].includes(provider.code) || provider.type === 'insufficient_quota';
        const rate = ['rate_limit_exceeded', 'slow_down'].includes(provider.code) || provider.type === 'rate_limit_error';
        message = quota ? 'OpenAI indicó que la cuota o el saldo de API no están disponibles (HTTP 429).' : rate ? 'OpenAI limitó la frecuencia de solicitudes (HTTP 429). Intenta más tarde.' : 'OpenAI indicó un límite de uso (HTTP 429). Revisa el diagnóstico del servidor para distinguir cuota y frecuencia.';
        code = quota ? 'openai_quota_exceeded' : 'upstream_limit'; status = 503;
      }
      throw openAIError(message, code, started, response, 'http', bodyError, provider, status);
    }
    if ([401, 403].includes(response.status)) throw new AppError(`Revisa la clave y los permisos de ${service} en el backend.`, 503, 'invalid_credentials');
    if (response.status === 429) throw new AppError(`${service} alcanzó su límite de uso. Revisa la cuota o intenta más tarde.`, 503, 'upstream_limit');
    if (response.status === 404) throw new AppError(`${service}: recurso no disponible. Revisa la propiedad o el modelo configurado.`, 502, 'not_found');
    throw new AppError(`${service} no pudo completar la consulta. Intenta nuevamente.`, 502, 'upstream_error');
  }
  try { return await response.json(); }
  catch (error) {
    if (service === 'OpenAI') {
      if (error?.name !== 'SyntaxError') throw openAITransportError(error, started, response, 'response_body');
      throw openAIError('OpenAI devolvió un cuerpo de respuesta que no es JSON válido.', 'invalid_response', started, response, 'response_body', error);
    }
    throw new AppError(`${service} devolvió una respuesta no válida.`, 502, 'invalid_response');
  }
}
