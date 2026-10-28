'use strict';

/** 与 ima-skill 一致的两类程序错误码。 */
const ERR_PROGRAMMATIC = -100;
const ERR_UPDATE_AVAILABLE = -200;

class DiaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DiaryError';
    this.code = Number.isFinite(Number(code)) ? Number(code) : ERR_PROGRAMMATIC;
  }
}

module.exports = { DiaryError, ERR_PROGRAMMATIC, ERR_UPDATE_AVAILABLE };
