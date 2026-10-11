(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Core8 = api;
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var BYTE_TIME = 1042n;
  var NAMES = ['NOP', 'LDI', 'MOV', 'ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR', 'LD', 'ST', 'JMP', 'JZ', 'JNZ', 'WAIT', 'HALT'];
  var LIMIT = 256;
  function time(value) {
    if (typeof value === 'bigint' && value >= 0n) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
    throw new TypeError('时间必须是非负整数微秒。');
  }
  function byte(value) { return Number.isInteger(value) && value >= 0 && value <= 255; }
  function image(values) {
    if (!Array.isArray(values) && !(values instanceof Uint8Array)) throw new TypeError('固件需要字节数组。');
    if (!values.length || values.length > 4096 || values.length % 4 || !Array.from(values).every(byte)) throw new RangeError('固件必须为 4–4096 字节，且长度是 4 的倍数。');
    return Uint8Array.from(values);
  }
  function copy(value) { return value === undefined ? null : JSON.parse(JSON.stringify(value)); }
  function append(list, item) { list.push(item); if (list.length > LIMIT) list.shift(); }
  function numeric(token, maximum) {
    if (!/^(0x[0-9a-f]+|[0-9]+)$/i.test(token)) return null;
    var n = Number(token);
    return Number.isSafeInteger(n) && n >= 0 && n <= maximum ? n : null;
  }
  function reg(token) { return /^R[0-7]$/i.test(token) ? Number(token.slice(1)) : null; }
  function assemble(source) {
    function bad(line, message) { return { ok: false, bytes: null, sourceMap: [], error: '第 ' + line + ' 行：' + message, line: line }; }
    if (typeof source !== 'string' || source.length > 100000) return bad(1, '程序需要不超过 100000 字符的文本。');
    var labels = new Map(), parsed = [], lines = source.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i].split(';')[0].trim();
      if (!s) continue;
      var match = /^([A-Z_][A-Z0-9_]*):/i.exec(s);
      if (match) {
        var label = match[1].toUpperCase();
        if (labels.has(label)) return bad(i + 1, '标签重复：' + label);
        labels.set(label, parsed.length * 4);
        s = s.slice(match[0].length).trim();
        if (!s) continue;
      }
      var instruction = /^([A-Z]+)(?:\s+(.*))?$/i.exec(s);
      if (!instruction) return bad(i + 1, '无法识别语句。');
      var op = NAMES.indexOf(instruction[1].toUpperCase());
      if (op < 0) return bad(i + 1, '未知指令：' + instruction[1]);
      var rest = (instruction[2] || '').trim();
      var args = rest ? rest.split(',').map(function (x) { return x.trim(); }) : [];
      parsed.push({ op: op, args: args, line: i + 1 });
      if (parsed.length > 1024) return bad(i + 1, '程序不能超过 1024 条指令。');
    }
    if (!parsed.length) return bad(1, '程序至少需要一条指令。');
    var result = [], sourceMap = [];
    for (var j = 0; j < parsed.length; j++) {
      var p = parsed[j], a = 0, b = 0, c = 0, value = null;
      var count = p.op === 0 || p.op === 17 ? 0 : p.op === 8 || p.op === 13 || p.op === 16 ? 1 : 2;
      if (p.args.length !== count) return bad(p.line, NAMES[p.op] + ' 需要 ' + count + ' 个参数。');
      if (p.op >= 1 && p.op <= 12 || p.op === 14 || p.op === 15) {
        a = reg(p.args[0]);
        if (a === null) return bad(p.line, '寄存器只能使用 R0–R7。');
      }
      if (p.op === 1) {
        b = numeric(p.args[1], 255);
        if (b === null) return bad(p.line, '立即数范围为 0–255。');
      } else if (p.op >= 2 && p.op <= 7) {
        b = reg(p.args[1]);
        if (b === null) return bad(p.line, '第二个参数必须是 R0–R7 寄存器。');
      } else if (p.op === 9 || p.op === 10) {
        b = numeric(p.args[1], 7);
        if (b === null) return bad(p.line, '移位数量范围为 0–7。');
      } else if (p.op >= 11 && p.op <= 16) {
        var argument = p.args[p.op === 13 || p.op === 16 ? 0 : 1];
        value = numeric(argument, 65535);
        if (p.op >= 13 && p.op <= 15) {
          if (value === null && labels.has(argument.toUpperCase())) {
            value = labels.get(argument.toUpperCase());
            if (value >= parsed.length * 4) return bad(p.line, '跳转标签后没有指令。');
          }
          if (value === null) return bad(p.line, '跳转地址或标签无效。');
          if (value > 4092 || value % 4) return bad(p.line, '跳转地址必须在 ROM 内且四字节对齐。');
        }
        if (value === null) return bad(p.line, '地址或等待数必须为 0–65535 的整数。');
        b = value & 255; c = value >>> 8;
      }
      result.push(p.op, a, b, c);
      sourceMap.push({ address: j * 4, line: p.line });
    }
    return { ok: true, bytes: Uint8Array.from(result), sourceMap: sourceMap, error: null, line: null };
  }

  function decode(raw) {
    var op = raw[0], a = raw[1], b = raw[2], c = raw[3];
    if (op > 17) return { error: 'F_ENCODING' };
    var valid = true;
    if (op === 0 || op === 17) valid = a === 0 && b === 0 && c === 0;
    else if (op === 1) valid = a <= 7 && c === 0;
    else if (op >= 2 && op <= 7) valid = a <= 7 && b <= 7 && c === 0;
    else if (op === 8) valid = a <= 7 && b === 0 && c === 0;
    else if (op === 9 || op === 10) valid = a <= 7 && b <= 7 && c === 0;
    else if (op === 13 || op === 16) valid = a === 0;
    else valid = a <= 7;
    if (!valid) return { error: 'F_ENCODING' };
    var address = b | (c << 8);
    if (op >= 13 && op <= 15 && (address > 4092 || address % 4)) return { error: 'F_TARGET', address: address };
    return { op: op, a: a, b: b, c: c, address: address };
  }

  class CPU {
    constructor(bytes, options) {
      options = options || {};
      this.id = options.id || 'mcu';
      this.firmware = image(bytes);
      this.rom = new Uint8Array(4096); this.rom.set(this.firmware);
      this.ram = new Uint8Array(1024); this.regs = new Uint8Array(8);
      this.generation = 0n; this.time = time(options.time === undefined ? 0n : options.time);
      this.powered = options.powered === true;
      this.history = []; this.trace = []; this.historyDropped = 0; this.traceDropped = 0; this.retiredCount = 0n;
      this.uart = { ctrl: 0, err: 0, tx: [], rx: [], active: null, rxEpoch: 0n };
      this.reset('cold', this.time);
    }
    _at(value) {
      var t = time(value);
      if (t < this.time) throw new RangeError('MCU 时间不能倒退。');
      this.time = t; return t;
    }
    _record(kind, details) {
      if (this.history.length === LIMIT) this.historyDropped++;
      append(this.history, Object.assign({ kind: kind, time: String(this.time), instance: this.id }, details || {}));
    }
    _fault(code, address, unknownPins) {
      this.status = 'FAULT'; this.fault = { code: code, pc: this.pc, time: String(this.time) };
      if (address !== undefined) this.fault.address = address;
      if (Array.isArray(unknownPins) && unknownPins.length) this.fault.unknownPins = unknownPins.slice();
      this.pending = null; this.startAt = null; this.waitUntil = null;
      this._record('fault', this.fault);
    }
    reset(kind, at) {
      if (kind !== 'cold' && kind !== 'warm') throw new TypeError('复位类型必须为 cold 或 warm。');
      var t = this._at(at); this.generation += 1n;
      this.pc = 0; this.sp = 0; this.regs.fill(0);
      if (kind === 'cold') this.ram.fill(0);
      this.dir = 0; this.out = 0; this.pd = 255; this.fault = null;
      this.uart = { ctrl: 0, err: 0, tx: [], rx: [], active: null, rxEpoch: this.uart.rxEpoch + 1n };
      this.pending = null; this.startAt = this.powered ? t : null; this.waitUntil = null;
      this.status = this.powered ? 'RUNNING' : 'OFF'; this.lastBus = null;
      this.retiredCount = 0n; this._record(kind === 'cold' ? 'cold-reset' : 'warm-reset');
      this._begin(t); return this;
    }
    setPowered(enabled, at) {
      var t = this._at(at); enabled = !!enabled;
      if (enabled === this.powered) return this;
      this.powered = enabled;
      if (enabled) return this.reset('cold', t);
      this.generation += 1n; this.uart.rxEpoch += 1n;
      this.uart.tx = []; this.uart.rx = []; this.uart.active = null;
      this.pending = null; this.startAt = null; this.waitUntil = null;
      this.status = 'OFF'; this._record('power-off'); return this;
    }
    _begin(at) {
      if (!this.powered || this.startAt === null || this.startAt !== at || this.pending) return;
      this.startAt = null; this.waitUntil = null; this.status = 'RUNNING';
      if (this.pc > 4092 || this.pc < 0 || this.pc % 4) { this._fault('F_FETCH', this.pc); return; }
      this.pending = { pc: this.pc, bytes: Array.from(this.rom.slice(this.pc, this.pc + 4)), start: at, retire: at + 1n };
    }
    nextTime() {
      if (!this.powered) return null;
      var candidates = [];
      if (this.pending) candidates.push(this.pending.retire);
      if (this.startAt !== null) candidates.push(this.startAt);
      if (this.uart.active) candidates.push(this.uart.active.done);
      return candidates.length ? candidates.reduce(function (a, b) { return a < b ? a : b; }) : null;
    }
    gpioDrives() {
      return Array.from({ length: 8 }, (_, bitIndex) => !this.powered || !(this.dir & (1 << bitIndex)) ? 'Z' : (this.out >>> bitIndex) & 1);
    }
    rxToken() {
      return this.powered && this.uart.ctrl & 2 ? { generation: String(this.generation), rxEpoch: String(this.uart.rxEpoch) } : null;
    }
    receive(value, at, token) {
      if (!byte(value)) throw new RangeError('UART 字节范围为 0–255。');
      this._at(at);
      if (!this.powered || !(this.uart.ctrl & 2)) return false;
      if (token !== undefined && (!token || token.generation !== String(this.generation) || token.rxEpoch !== String(this.uart.rxEpoch))) return false;
      if (this.uart.rx.length >= 16) { this.uart.err |= 2; this._record('rx-overflow', { byte: value }); return false; }
      this.uart.rx.push(value); this._record('rx', { byte: value }); return true;
    }
    complete(at, io) {
      var t = this._at(at), active = this.uart.active;
      if (!this.powered || !active || active.done !== t) return false;
      if (active.generation !== this.generation) return false;
      this.uart.tx.shift(); this.uart.active = null;
      var delivered = false;
      if (io && typeof io.completeTx === 'function') delivered = io.completeTx(active.byte, copy(active.token), t, this) === true;
      this._record('tx', { byte: active.byte, delivered: delivered });
      return true;
    }
    _read(address, gpio) {
      if (address < 4096) return { value: this.rom[address] };
      if (address >= 0x2000 && address <= 0x23ff) return { value: this.ram[address - 0x2000] };
      switch (address) {
        case 0x4000: return { value: this.dir };
        case 0x4001: return { value: this.out };
        case 0x4002: {
          if (!Array.isArray(gpio) || gpio.length !== 8) return { error: 'F_UNKNOWN', unknownPins: Array.from({length:8}, (_, i) => 'GPIO' + i) };
          var n = 0, unknownPins = [];
          for (var i = 0; i < 8; i++) {
            if (gpio[i] !== 0 && gpio[i] !== 1 && gpio[i] !== '0' && gpio[i] !== '1') unknownPins.push('GPIO' + i);
            else n |= Number(gpio[i]) << i;
          }
          if (unknownPins.length) return { error: 'F_UNKNOWN', unknownPins: unknownPins };
          return { value: n };
        }
        case 0x4003: return { value: this.pd };
        case 0x4101:
          if (!(this.uart.ctrl & 2)) return { error: 'F_ACCESS' };
          return this.uart.rx.length ? { value: this.uart.rx[0], popRx: true } : { error: 'F_RX_EMPTY' };
        case 0x4102: return { value: (this.uart.tx.length === 16 ? 1 : 0) | (!this.uart.tx.length ? 2 : 0) | (this.uart.rx.length ? 4 : 0) | (this.uart.err ? 8 : 0) };
        case 0x4103: return { value: this.uart.ctrl };
        case 0x4104: return { value: this.uart.err };
        case 0x4105: return { value: this.uart.tx.length };
        case 0x4106: return { value: this.uart.rx.length };
        default: return { error: 'F_ACCESS' };
      }
    }
    _writeCheck(address, value) {
      if (address >= 0x2000 && address <= 0x23ff) return null;
      if (address === 0x4000 || address === 0x4001 || address === 0x4003) return null;
      if (address === 0x4100) return this.uart.ctrl & 1 ? null : 'F_ACCESS';
      if (address === 0x4103 || address === 0x4104) return value & 252 ? 'F_ACCESS' : null;
      return 'F_ACCESS';
    }
    _write(address, value) {
      if (address >= 0x2000 && address <= 0x23ff) { this.ram[address - 0x2000] = value; return; }
      if (address === 0x4000) this.dir = value;
      else if (address === 0x4001) this.out = value;
      else if (address === 0x4003) this.pd = value;
      else if (address === 0x4100) {
        if (this.uart.tx.length >= 16) this.uart.err |= 1;
        else this.uart.tx.push(value);
      } else if (address === 0x4103) {
        if (this.uart.ctrl & 1 && !(value & 1)) { this.uart.tx = []; this.uart.active = null; }
        if (this.uart.ctrl & 2 && !(value & 2)) { this.uart.rx = []; this.uart.rxEpoch += 1n; }
        this.uart.ctrl = value;
      } else if (address === 0x4104) this.uart.err &= ~value;
    }
    sample(at, gpio) {
      var t = this._at(at);
      if (!this.powered || !this.pending || this.pending.retire !== t) return null;
      var d = decode(this.pending.bytes);
      var intent = { time: t, generation: this.generation, pc: this.pc, raw: this.pending.bytes.slice(), nextPc: (this.pc + 4) & 65535 };
      if (d.error) { intent.error = d.error; intent.address = d.address; return intent; }
      var a = d.a, b = d.b, result = null;
      if (d.op === 1) result = b;
      else if (d.op === 2) result = this.regs[b];
      else if (d.op === 3) result = (this.regs[a] + this.regs[b]) & 255;
      else if (d.op === 4) result = (this.regs[a] - this.regs[b]) & 255;
      else if (d.op === 5) result = this.regs[a] & this.regs[b];
      else if (d.op === 6) result = this.regs[a] | this.regs[b];
      else if (d.op === 7) result = this.regs[a] ^ this.regs[b];
      else if (d.op === 8) result = this.regs[a] ^ 255;
      else if (d.op === 9) result = (this.regs[a] << b) & 255;
      else if (d.op === 10) result = this.regs[a] >>> b;
      else if (d.op === 11) {
        var read = this._read(d.address, gpio);
        if (read.error) { intent.error = read.error; intent.address = d.address; intent.unknownPins = read.unknownPins; return intent; }
        result = read.value; intent.popRx = !!read.popRx;
        intent.bus = { kind: 'read', address: d.address, value: result };
      } else if (d.op === 12) {
        var error = this._writeCheck(d.address, this.regs[a]);
        if (error) { intent.error = error; intent.address = d.address; return intent; }
        intent.write = { address: d.address, value: this.regs[a] };
        intent.bus = { kind: 'write', address: d.address, value: this.regs[a] };
      } else if (d.op === 13 || d.op === 14 && this.regs[a] === 0 || d.op === 15 && this.regs[a] !== 0) intent.nextPc = d.address;
      if (result !== null) intent.register = { index: a, value: result };
      if (d.op === 16) intent.wait = d.address;
      if (d.op === 17) intent.halt = true;
      return intent;
    }
    commit(intent) {
      if (!intent) return false;
      if (intent.generation !== this.generation || !this.pending || intent.pc !== this.pc || intent.time !== this.pending.retire || !this.powered) return false;
      this._at(intent.time);
      if (intent.error) { this._fault(intent.error, intent.address, intent.unknownPins); return false; }
      if (intent.register) this.regs[intent.register.index] = intent.register.value;
      if (intent.popRx) this.uart.rx.shift();
      if (intent.write) this._write(intent.write.address, intent.write.value);
      if (intent.bus) this.lastBus = Object.assign({ time: String(this.time) }, intent.bus);
      this.pc = intent.nextPc; this.pending = null; this.retiredCount += 1n;
      if (this.trace.length === LIMIT) this.traceDropped++;
      append(this.trace, { time: String(this.time), pc: intent.pc, op: NAMES[intent.raw[0]], bytes: intent.raw });
      if (intent.halt) { this.status = 'HALTED'; this.startAt = null; this.waitUntil = null; }
      else {
        this.startAt = this.time + BigInt(intent.wait || 0);
        this.waitUntil = intent.wait ? this.startAt : null;
        this.status = intent.wait ? 'WAITING' : 'RUNNING';
      }
      return true;
    }
    retire(at, gpio) { return this.commit(this.sample(at, gpio)); }
    flush(at, io) {
      var t = this._at(at);
      if (!this.powered) return;
      this._begin(t);
      if (this.uart.ctrl & 1 && this.uart.tx.length && !this.uart.active) {
        var value = this.uart.tx[0];
        var token = io && typeof io.startTx === 'function' ? io.startTx(value, t, this) : null;
        this.uart.active = { byte: value, start: t, done: t + BYTE_TIME, token: copy(token), generation: this.generation };
      }
    }
    exportState() {
      function replacer(key, value) { return typeof value === 'bigint' ? String(value) : value instanceof Uint8Array ? Array.from(value) : value; }
      return JSON.parse(JSON.stringify({ schema: 'core8.snapshot/1', id: this.id, firmware: this.firmware, powered: this.powered, time: this.time,
        generation: this.generation, pc: this.pc, sp: this.sp, regs: this.regs, ram: this.ram, dir: this.dir, out: this.out, pd: this.pd,
        status: this.status, fault: this.fault, retiredCount: this.retiredCount, uart: this.uart, pending: this.pending, startAt: this.startAt,
        waitUntil: this.waitUntil, lastBus: this.lastBus, history: this.history, trace: this.trace,
        historyDropped: this.historyDropped, traceDropped: this.traceDropped }, replacer));
    }
    importState(data) {
      var d = copy(data);
      if (!d || d.schema !== 'core8.snapshot/1' || typeof d.powered !== 'boolean' || d.id !== this.id) throw new TypeError('MCU 快照或实例标识无效。');
      var firmware = image(d.firmware);
      if (firmware.length !== this.firmware.length || firmware.some((v, i) => v !== this.firmware[i])) throw new TypeError('快照固件与当前 MCU 不匹配。');
      function array(values, size) { if (!Array.isArray(values) || values.length !== size || !values.every(byte)) throw new TypeError('快照字节数组无效。'); return Uint8Array.from(values); }
      function fifo(values) { if (!Array.isArray(values) || values.length > 16 || !values.every(byte)) throw new TypeError('快照 FIFO 无效。'); return values.slice(); }
      var regs = array(d.regs, 8), ram = array(d.ram, 1024);
      if (![d.dir, d.out, d.pd].every(byte) || !Number.isInteger(d.pc) || d.pc < 0 || d.pc > 65535 || d.sp !== 0 || !['OFF', 'RUNNING', 'WAITING', 'HALTED', 'FAULT'].includes(d.status)) throw new TypeError('快照 MCU 字段无效。');
      if (!d.uart || !Number.isInteger(d.uart.ctrl) || d.uart.ctrl < 0 || d.uart.ctrl > 3 || !Number.isInteger(d.uart.err) || d.uart.err < 0 || d.uart.err > 3) throw new TypeError('快照 UART 字段无效。');
      var t = time(d.time), generation = time(d.generation), retiredCount = time(d.retiredCount);
      var uart = { ctrl: d.uart.ctrl, err: d.uart.err, tx: fifo(d.uart.tx), rx: fifo(d.uart.rx), active: null, rxEpoch: time(d.uart.rxEpoch) };
      if (d.uart.active) {
        var active = d.uart.active;
        if (!byte(active.byte) || uart.tx[0] !== active.byte || !(uart.ctrl & 1)) throw new TypeError('快照发送事务无效。');
        uart.active = { byte: active.byte, start: time(active.start), done: time(active.done), token: copy(active.token), generation: time(active.generation) };
        if (uart.active.done - uart.active.start !== BYTE_TIME || uart.active.start > t || uart.active.done <= t || uart.active.generation !== generation) throw new TypeError('快照发送时间无效。');
      }
      var pending = null;
      if (d.pending) {
        var p = d.pending;
        if (p.pc !== d.pc || p.pc > 4092 || p.pc % 4) throw new TypeError('快照取指地址无效。');
        var locked = array(p.bytes, 4);
        if (locked.some((v, i) => v !== this.rom[p.pc + i])) throw new TypeError('快照取指与固件不符。');
        pending = { pc: p.pc, bytes: Array.from(locked), start: time(p.start), retire: time(p.retire) };
        if (pending.retire !== pending.start + 1n || pending.start > t || pending.retire <= t) throw new TypeError('快照退休时刻无效。');
      }
      var startAt = d.startAt === null ? null : time(d.startAt), waitUntil = d.waitUntil === null ? null : time(d.waitUntil);
      if (startAt !== null && startAt < t || pending && startAt !== null) throw new TypeError('快照等待状态无效。');
      if (!d.powered && (pending || startAt !== null || uart.active || d.status !== 'OFF')) throw new TypeError('未供电快照仍有活动事件。');
      if (['HALTED', 'FAULT'].includes(d.status) && (pending || startAt !== null)) throw new TypeError('已停止快照仍有 CPU 事件。');
      if (d.powered && d.status === 'OFF' || d.status === 'RUNNING' && (!pending || startAt !== null || waitUntil !== null) || d.status === 'WAITING' && (pending || startAt === null || startAt <= t || waitUntil !== startAt)) throw new TypeError('快照执行模式与事件不一致。');
      if (!(uart.ctrl & 1) && uart.tx.length || !(uart.ctrl & 2) && uart.rx.length || d.powered && uart.tx.length && !uart.active) throw new TypeError('快照 FIFO 与使能或在途状态不一致。');
      if (d.status === 'FAULT' && (!d.fault || d.fault.pc !== d.pc || !['F_FETCH','F_ENCODING','F_TARGET','F_ACCESS','F_UNKNOWN','F_RX_EMPTY'].includes(d.fault.code)) || d.status !== 'FAULT' && d.fault !== null) throw new TypeError('快照故障状态不一致。');
      if (!Array.isArray(d.history) || d.history.length > LIMIT || !Array.isArray(d.trace) || d.trace.length > LIMIT) throw new TypeError('快照观察历史超限。');
      if (![d.historyDropped,d.traceDropped].every(v => Number.isSafeInteger(v) && v >= 0)) throw new TypeError('快照历史计数无效。');
      Object.assign(this, { powered: d.powered, time: t, generation: generation, pc: d.pc, sp: d.sp, regs: regs, ram: ram, dir: d.dir, out: d.out, pd: d.pd,
        status: d.status, fault: copy(d.fault), retiredCount: retiredCount, uart: uart, pending: pending, startAt: startAt, waitUntil: waitUntil,
        lastBus: copy(d.lastBus), history: copy(d.history), trace: copy(d.trace), historyDropped: d.historyDropped, traceDropped: d.traceDropped });
      return this;
    }
  }
  var SAMPLES = [
    { id: 'blinkButton', name: '智能灯 · 闪烁与按键', description: 'GPIO1 闪灯；GPIO0 按下发送 P、释放发送 R，启动发送 B。', source: 'LDI R0, 2\nST R0, 0x4000\nLDI R0, 3\nST R0, 0x4103\nLDI R0, 0x42\nST R0, 0x4100\nLDI R6, 1\nLDI R7, 2\nLDI R4, 0\nloop:\nLD R1, 0x4002\nAND R1, R6\nMOV R2, R1\nXOR R2, R4\nJZ R2, unchanged\nJZ R1, released\nLDI R0, 0x50\nJMP send\nreleased:\nLDI R0, 0x52\nsend:\nST R0, 0x4100\nMOV R4, R1\nunchanged:\nXOR R3, R7\nST R3, 0x4001\nWAIT 60000\nJMP loop' },
    { id: 'echo', name: '串口 · 接收后回传', description: '从终端发送字节，程序检查接收状态再原样回传。', source: 'LDI R0, 3\nST R0, 0x4103\nLDI R2, 4\nloop:\nLD R1, 0x4102\nAND R1, R2\nJZ R1, loop\nLD R0, 0x4101\nST R0, 0x4100\nJMP loop' }
  ];
  return { CPU: CPU, assemble: assemble, SAMPLES: SAMPLES, BYTE_TIME: BYTE_TIME, NAMES: NAMES };
}));
