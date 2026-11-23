const MAX_ROWS = 150;
const MAX_ID_LENGTH = 32;
const MAX_SESSAO_LENGTH = 100;
const MAX_CHANNELS = 1000000;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAsciiAlphaNumeric(code) {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function isValidId(value) {
  if (typeof value !== "string") {
    return false;
  }
  if (value.length < 1 || value.length > MAX_ID_LENGTH) {
    return false;
  }
  const firstCode = value.charCodeAt(0);
  if (!isAsciiAlphaNumeric(firstCode)) {
    return false;
  }
  for (let i = 1; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (!isAsciiAlphaNumeric(code) && code !== 95 && code !== 45) {
      return false;
    }
  }
  return true;
}

function normalizeSessao(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_SESSAO_LENGTH) {
    return null;
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code <= 0x001f || (code >= 0x007f && code <= 0x009f)) {
      return null;
    }
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
      return null;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= trimmed.length) {
        return null;
      }
      const nextCode = trimmed.charCodeAt(i + 1);
      if (nextCode < 0xdc00 || nextCode > 0xdfff) {
        return null;
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return null;
    }
  }
  return trimmed;
}

function normalizeInteger(raw, minValue, maxValue) {
  if (typeof raw !== "number" || !Number.isInteger(raw) || !Number.isSafeInteger(raw)) {
    return null;
  }
  if (raw < minValue || raw > maxValue) {
    return null;
  }
  if (raw === 0) {
    return 0;
  }
  return raw;
}

function normalizeBoolean(raw) {
  if (typeof raw !== "boolean") {
    return null;
  }
  return raw;
}

function isDeclaredRowKey(key) {
  return (
    key === "id" ||
    key === "sessao" ||
    key === "canaisPedidos" ||
    key === "canaisMontados" ||
    key === "entradasDisponiveis" ||
    key === "somTestado"
  );
}

function hasUnexpectedRowFields(row) {
  const keys = Object.keys(row);
  for (const key of keys) {
    if (!isDeclaredRowKey(key)) {
      return true;
    }
  }
  return false;
}

function collectConditionIssues(canaisPedidos, canaisMontados, entradasDisponiveis, somTestado) {
  const issues = [];
  if (canaisMontados < canaisPedidos) {
    issues.push("canaisCompletos");
  }
  if (canaisMontados > entradasDisponiveis) {
    issues.push("entradasSuficientes");
  }
  if (somTestado !== true) {
    issues.push("passagemFeita");
  }
  return issues;
}

function extractValidRowsArray(input) {
  if (!isPlainObject(input)) {
    return null;
  }
  if (!Object.hasOwn(input, "rows")) {
    return null;
  }
  const envelopeKeys = Object.keys(input);
  if (envelopeKeys.length !== 1) {
    return null;
  }
  for (const key of envelopeKeys) {
    if (key !== "rows") {
      return null;
    }
  }
  const rows = input.rows;
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
    return null;
  }
  return rows;
}

function evaluateRow(row, rowId, isDuplicate) {
  const sessao = Object.hasOwn(row, "sessao") ? normalizeSessao(row.sessao) : null;
  const canaisPedidos = Object.hasOwn(row, "canaisPedidos")
    ? normalizeInteger(row.canaisPedidos, 1, MAX_CHANNELS)
    : null;
  const canaisMontados = Object.hasOwn(row, "canaisMontados")
    ? normalizeInteger(row.canaisMontados, 0, MAX_CHANNELS)
    : null;
  const entradasDisponiveis = Object.hasOwn(row, "entradasDisponiveis")
    ? normalizeInteger(row.entradasDisponiveis, 1, MAX_CHANNELS)
    : null;
  const somTestado = Object.hasOwn(row, "somTestado")
    ? normalizeBoolean(row.somTestado)
    : null;

  const validationIssues = [];
  if (sessao === null) {
    validationIssues.push("sessao");
  }
  if (canaisPedidos === null) {
    validationIssues.push("canaisPedidos");
  }
  if (canaisMontados === null) {
    validationIssues.push("canaisMontados");
  }
  if (entradasDisponiveis === null) {
    validationIssues.push("entradasDisponiveis");
  }
  if (somTestado === null) {
    validationIssues.push("somTestado");
  }
  if (hasUnexpectedRowFields(row)) {
    validationIssues.push("unexpectedFields");
  }

  let status = "OK";
  let issuesText = "";

  if (isDuplicate) {
    status = "DUPLICATE";
    issuesText = "duplicateId";
  } else if (validationIssues.length > 0) {
    status = "INVALID";
    issuesText = validationIssues.join(", ");
  } else {
    const conditionIssues = collectConditionIssues(
      canaisPedidos,
      canaisMontados,
      entradasDisponiveis,
      somTestado
    );
    if (conditionIssues.length > 0) {
      status = "PENDING";
      issuesText = conditionIssues.join(", ");
    }
  }

  return {
    id: rowId,
    sessao: sessao,
    canaisPedidos: canaisPedidos,
    canaisMontados: canaisMontados,
    entradasDisponiveis: entradasDisponiveis,
    somTestado: somTestado,
    status: status,
    issues: issuesText
  };
}

export function evaluate(input) {
  const inputRows = extractValidRowsArray(input);
  if (inputRows === null) {
    return { error: "INVALID_INPUT" };
  }

  const idCounts = new Map();
  const rowEntries = [];

  for (const row of inputRows) {
    if (!isPlainObject(row) || !Object.hasOwn(row, "id")) {
      return { error: "INVALID_INPUT" };
    }
    const rowId = row.id;
    if (!isValidId(rowId)) {
      return { error: "INVALID_INPUT" };
    }
    const lowerId = rowId.toLowerCase();
    const previousCount = idCounts.get(lowerId);
    if (previousCount === undefined) {
      idCounts.set(lowerId, 1);
    } else {
      idCounts.set(lowerId, previousCount + 1);
    }
    rowEntries.push({
      row: row,
      id: rowId,
      lowerId: lowerId
    });
  }

  const outputRows = [];
  let validCount = 0;
  let pendingCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;
  let totalCanaisPedidos = 0;
  let totalCanaisMontados = 0;

  for (const entry of rowEntries) {
    const count = idCounts.get(entry.lowerId);
    const isDuplicate = count !== undefined && count > 1;
    const evaluated = evaluateRow(entry.row, entry.id, isDuplicate);
    outputRows.push(evaluated);

    if (evaluated.status === "OK") {
      validCount += 1;
      totalCanaisPedidos += evaluated.canaisPedidos;
      totalCanaisMontados += evaluated.canaisMontados;
    } else if (evaluated.status === "PENDING") {
      pendingCount += 1;
      totalCanaisPedidos += evaluated.canaisPedidos;
      totalCanaisMontados += evaluated.canaisMontados;
    } else if (evaluated.status === "INVALID") {
      invalidCount += 1;
    } else {
      duplicateCount += 1;
    }
  }

  return {
    rows: outputRows,
    summary: {
      valid: validCount,
      pending: pendingCount,
      invalid: invalidCount,
      duplicates: duplicateCount,
      totalCanaisPedidos: totalCanaisPedidos,
      totalCanaisMontados: totalCanaisMontados
    }
  };
}
