(function(root,factory){
  'use strict';
  var base=typeof module==='object'&&module.exports?require('./core8.js'):root.Core8;
  var api=factory(base);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.Core8Plus=api;
}(typeof window!=='undefined'?window:null,function(Base){
  'use strict';
  if(!Base)throw new Error('Core8Plus 需要先加载 Core8。');
  var SPI_TIME=8n,I2C_TIME=100n;
  function clone(v){return v===undefined?null:JSON.parse(JSON.stringify(v,(k,x)=>typeof x==='bigint'?String(x):x));}
  function integer(v,max){return Number.isInteger(v)&&v>=0&&v<=max;}
  function stamp(v){if(typeof v==='bigint'&&v>=0n)return v;if(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v))return BigInt(v);throw new TypeError('扩展时间必须是非负十进制整数。');}
  function fresh(){return {timer:{ctrl:0,period:0,flag:0,next:null,fires:0n},pwm:{ctrl:0,period:0,duty:0,activeDuty:0,level:0,cycle:null,next:null},spi:{ctrl:0,data:0,mode:0,status:0,active:null},i2c:{ctrl:0,address:0,register:0,data:0,status:0,active:null},irq:{enabled:0,mask:0,pending:0,vector:0,active:0,cause:0,frame:null,entries:0n}};}
  function assemble(source){
    if(typeof source!=='string'||source.length>100000)return Base.assemble(source);
    var originals=source.split(/\r?\n/),iretLines=new Set();
    var rewritten=originals.map(function(line,index){
      var code=line.split(';')[0],m=/^(\s*(?:[A-Z_][A-Z0-9_]*:\s*)?)IRET\s*$/i.exec(code);
      if(!m)return line;
      iretLines.add(index+1);return m[1]+'NOP'+(line.includes(';')?';'+line.split(';').slice(1).join(';'):'');
    }).join('\n');
    var a=Base.assemble(rewritten);
    if(a.ok)for(var m of a.sourceMap)if(iretLines.has(m.line))a.bytes[m.address]=0x12;
    return a;
  }
  class CPU extends Base.CPU{
    reset(kind,at){super.reset(kind,at);this.plus=fresh();return this;}
    setPowered(enabled,at){var changed=!!enabled!==this.powered;super.setPowered(enabled,at);if(changed&&!enabled)this.plus=fresh();return this;}
    nextTime(){var base=super.nextTime();if(!this.powered)return null;var p=this.plus,times=[base,p.timer.next,p.pwm.next,p.spi.active?.done,p.i2c.active?.done].filter(t=>t!==null&&t!==undefined);return times.length?times.reduce((a,b)=>a<b?a:b):null;}
    pwmOutput(){return this.powered&&(this.plus.pwm.ctrl&1)?this.plus.pwm.level:'Z';}
    _raise(mask){this.plus.irq.pending|=mask;}
    _pwmCycle(at){var p=this.plus.pwm;p.cycle=at;p.activeDuty=Math.min(p.duty,p.period);p.level=p.activeDuty>0?1:0;p.next=at+BigInt(p.activeDuty>0&&p.activeDuty<p.period?p.activeDuty:p.period);}
    complete(at,io){
      var t=this._at(at),changed=super.complete(t,io);if(!this.powered)return changed;
      var p=this.plus,timer=p.timer,pwm=p.pwm;
      if(timer.next===t){timer.fires++;timer.flag=1;if(timer.ctrl&4)this._raise(1);this._record('timer',{count:String(timer.fires)});if(timer.ctrl&2)timer.next=t+BigInt(timer.period);else{timer.ctrl&=~1;timer.next=null;}changed=true;}
      if(pwm.next===t){if(t===pwm.cycle+BigInt(pwm.period))this._pwmCycle(t);else{pwm.level=0;pwm.next=pwm.cycle+BigInt(pwm.period);}changed=true;}
      for(var kind of ['spi','i2c']){
        var port=p[kind],active=port.active;if(!active||active.done!==t)continue;
        port.active=null;port.status&=~1;
        if(active.generation!==this.generation||!(port.ctrl&1))continue;
        var result=io&&typeof io.completeProtocol==='function'?io.completeProtocol(kind==='spi'?'spi-txn/1':'i2c-txn/1',clone(active.request),clone(active.token),t,this):{ok:false,error:kind==='i2c'?'NACK':'DISCONNECTED'};
        if(!result||result.ok!==true){port.status|=kind==='i2c'&&(!result||result.error==='NACK'||result.error==='DISCONNECTED')?4:kind==='spi'?4:8;}
        else if(!integer(result.value,255)){port.status|=kind==='spi'?4:8;result={ok:false,error:'INVALID_RESPONSE'};}
        else port.data=result.value;
        port.status|=2;if(port.ctrl&2)this._raise(kind==='spi'?2:4);
        this._record(kind,{request:clone(active.request),ok:!!result&&result.ok===true,value:port.data,error:result?.ok===true?null:result?.error||'NACK'});changed=true;
      }
      return changed;
    }
    _read(address,gpio){
      var p=this.plus,t=p.timer,w=p.pwm,s=p.spi,i=p.i2c,q=p.irq;
      var count=t.next===null?0:Math.max(0,t.period-Number(t.next-this.time));
      var values={0x4200:t.ctrl,0x4201:t.period&255,0x4202:t.period>>>8,0x4203:t.flag,0x4204:count&255,0x4205:count>>>8,
        0x4300:w.ctrl,0x4301:w.period&255,0x4302:w.period>>>8,0x4303:w.duty&255,0x4304:w.duty>>>8,0x4305:w.level,
        0x4400:i.ctrl,0x4401:i.address,0x4402:i.register,0x4403:i.data,0x4405:i.status,
        0x4500:s.ctrl,0x4501:s.data,0x4502:s.status,0x4503:s.mode,
        0x4600:q.enabled,0x4601:q.mask,0x4602:q.pending,0x4603:q.vector&255,0x4604:q.vector>>>8,0x4605:q.active,0x4606:q.cause};
      return Object.hasOwn(values,address)?{value:values[address]}:super._read(address,gpio);
    }
    _writeCheck(address,value){
      var p=this.plus;
      if(address===0x4200)return value>7||(value&1)&&!p.timer.period?'F_ACCESS':null;
      if(address===0x4201||address===0x4202)return p.timer.ctrl&1?'F_ACCESS':null;
      if(address===0x4203)return value>1?'F_ACCESS':null;
      if(address===0x4300)return value>1||(value&1)&&!p.pwm.period?'F_ACCESS':null;
      if(address===0x4301||address===0x4302)return p.pwm.ctrl&1?'F_ACCESS':null;
      if(address===0x4303||address===0x4304)return null;
      if(address===0x4400||address===0x4500)return value>3?'F_ACCESS':null;
      if([0x4401,0x4402,0x4403].includes(address))return p.i2c.active||address===0x4401&&value>127?'F_ACCESS':null;
      if(address===0x4404)return !(p.i2c.ctrl&1)||p.i2c.active||![1,2].includes(value)?'F_ACCESS':null;
      if(address===0x4405)return value&~14?'F_ACCESS':null;
      if(address===0x4501)return !(p.spi.ctrl&1)||p.spi.active?'F_ACCESS':null;
      if(address===0x4502)return value&~6?'F_ACCESS':null;
      if(address===0x4503)return p.spi.active||value>3?'F_ACCESS':null;
      if(address===0x4600)return value>1||value&&(p.irq.vector>4092||p.irq.vector%4)?'F_ACCESS':null;
      if(address===0x4601||address===0x4602)return value>7?'F_ACCESS':null;
      if(address===0x4603||address===0x4604)return p.irq.enabled||p.irq.active?'F_ACCESS':null;
      return super._writeCheck(address,value);
    }
    _start(kind,request){var port=this.plus[kind];port.status=1;port.active={request:clone(request),start:this.time,done:this.time+(kind==='spi'?SPI_TIME:I2C_TIME),token:null,generation:this.generation,started:false};}
    _write(address,value){
      var p=this.plus,t=p.timer,w=p.pwm,s=p.spi,i=p.i2c,q=p.irq;
      switch(address){
        case 0x4200:t.ctrl=value;t.next=value&1?this.time+BigInt(t.period):null;break;
        case 0x4201:t.period=(t.period&0xff00)|value;break;case 0x4202:t.period=(t.period&255)|(value<<8);break;case 0x4203:t.flag&=~value;break;
        case 0x4300:var was=w.ctrl;w.ctrl=value;if(!value){w.next=null;w.cycle=null;w.level=0;}else if(!was)this._pwmCycle(this.time);break;
        case 0x4301:w.period=(w.period&0xff00)|value;break;case 0x4302:w.period=(w.period&255)|(value<<8);break;
        case 0x4303:w.duty=(w.duty&0xff00)|value;break;case 0x4304:w.duty=(w.duty&255)|(value<<8);break;
        case 0x4400:i.ctrl=value;if(!(value&1)){i.active=null;i.status&=~1;}break;
        case 0x4401:i.address=value;break;case 0x4402:i.register=value;break;case 0x4403:i.data=value;break;
        case 0x4404:this._start('i2c',{address:i.address,register:i.register,read:value===1,value:i.data});break;
        case 0x4405:i.status&=~value;break;
        case 0x4500:s.ctrl=value;if(!(value&1)){s.active=null;s.status&=~1;}break;
        case 0x4501:this._start('spi',{byte:value,mode:s.mode});break;
        case 0x4502:s.status&=~value;break;case 0x4503:s.mode=value;break;
        case 0x4600:q.enabled=value;break;case 0x4601:q.mask=value;break;case 0x4602:q.pending&=~value;break;
        case 0x4603:q.vector=(q.vector&0xff00)|value;break;case 0x4604:q.vector=(q.vector&255)|(value<<8);break;
        default:super._write(address,value);
      }
    }
    sample(at,gpio){
      if(!this.powered||!this.pending||this.pending.retire!==BigInt(at)||this.pending.bytes[0]!==0x12)return super.sample(at,gpio);
      var t=this._at(at),q=this.plus.irq,raw=this.pending.bytes.slice();
      return {time:t,generation:this.generation,pc:this.pc,raw:raw,nextPc:q.frame?.pc||0,iret:true,...(raw.slice(1).some(x=>x)?{error:'F_ENCODING'}:!q.active||!q.frame?{error:'F_ACCESS'}:{})};
    }
    commit(intent){
      var ok=super.commit(intent);
      if(ok&&intent.iret){this.plus.irq.active=0;this.plus.irq.frame=null;this.trace[this.trace.length-1].op='IRET';this._record('irq-return',{pc:this.pc});}
      return ok;
    }
    flush(at,io){
      var t=this._at(at);if(!this.powered)return;
      var q=this.plus.irq,available=q.pending&q.mask;
      if(!this.pending&&!q.active&&q.enabled&&available&&!['HALTED','FAULT','OFF'].includes(this.status)){
        var cause=available&-available;
        if(q.vector>4092||q.vector%4){this._fault('F_TARGET',q.vector);}
        else{q.frame={pc:this.pc};q.active=1;q.cause=cause;q.pending&=~cause;q.entries++;this.pc=q.vector;this.startAt=t;this.waitUntil=null;this.status='RUNNING';this._record('irq-enter',{cause:cause,returnPc:q.frame.pc,vector:q.vector});}
      }
      super.flush(t,io);
      for(var kind of ['spi','i2c']){
        var a=this.plus[kind].active;
        if(a&&!a.started){a.token=clone(io&&typeof io.startProtocol==='function'?io.startProtocol(kind==='spi'?'spi-txn/1':'i2c-txn/1',clone(a.request),t,this):null);a.started=true;}
      }
    }
    exportState(){var base=super.exportState();base.schema='core8.snapshot/2';base.plus=clone(this.plus);return base;}
    importState(data){
      var d=clone(data);if(!d||d.schema!=='core8.snapshot/2'||!d.plus)throw new TypeError('需要 Core8/2 快照。');
      var p=d.plus,t=stamp(d.time),generation=stamp(d.generation);
      function keys(v,expected){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==expected.slice().sort().join(','))throw new TypeError('扩展快照字段无效。');}
      function number(v,max){if(!integer(v,max))throw new TypeError('扩展快照数值无效。');}
      function nullable(v){return v===null?null:stamp(v);}
      keys(p,['timer','pwm','spi','i2c','irq']);keys(p.timer,['ctrl','period','flag','next','fires']);keys(p.pwm,['ctrl','period','duty','activeDuty','level','cycle','next']);
      var timer=p.timer,pwm=p.pwm;
      number(timer.ctrl,7);number(timer.period,65535);number(timer.flag,1);timer.next=nullable(timer.next);timer.fires=stamp(timer.fires);
      if(!!(timer.ctrl&1)!==(timer.next!==null)||timer.next!==null&&(!timer.period||timer.next<=t||timer.next>t+BigInt(timer.period)))throw new TypeError('定时器快照期限无效。');
      number(pwm.ctrl,1);number(pwm.period,65535);number(pwm.duty,65535);number(pwm.activeDuty,65535);number(pwm.level,1);pwm.next=nullable(pwm.next);pwm.cycle=nullable(pwm.cycle);
      if(pwm.ctrl){if(!pwm.period||pwm.cycle===null||pwm.cycle>t||pwm.next===null||pwm.next<=t||pwm.activeDuty>pwm.period)throw new TypeError('PWM 快照期限无效。');var edge=pwm.cycle+BigInt(pwm.activeDuty),end=pwm.cycle+BigInt(pwm.period);if(t>=end||pwm.level!==(pwm.activeDuty>0&&t<edge?1:0)||pwm.next!==(pwm.level&&pwm.activeDuty<pwm.period?edge:end))throw new TypeError('PWM 快照相位无效。');}
      else if(pwm.next!==null||pwm.cycle!==null||pwm.level)throw new TypeError('已禁用 PWM 仍在调度。');
      for(var kind of ['spi','i2c']){
        var port=p[kind];keys(port,kind==='spi'?['ctrl','data','mode','status','active']:['ctrl','address','register','data','status','active']);number(port.ctrl,3);number(port.data,255);number(port.status,kind==='spi'?7:15);
        if(kind==='spi')number(port.mode,3);else{number(port.address,127);number(port.register,255);}
        if(!!(port.status&1)!==!!port.active)throw new TypeError('事务快照忙状态无效。');
        if(port.active){var a=port.active;keys(a,['request','start','done','token','generation','started']);a.start=stamp(a.start);a.done=stamp(a.done);a.generation=stamp(a.generation);if(!(port.ctrl&1)||a.started!==true||a.start>t||a.done<=t||a.done-a.start!==(kind==='spi'?SPI_TIME:I2C_TIME)||a.generation!==generation)throw new TypeError('事务快照期限无效。');
          if(kind==='spi'){keys(a.request,['byte','mode']);number(a.request.byte,255);number(a.request.mode,3);}else{keys(a.request,['address','register','read','value']);number(a.request.address,127);number(a.request.register,255);number(a.request.value,255);if(typeof a.request.read!=='boolean')throw new TypeError('I2C 请求无效。');}
        }
      }
      var q=p.irq;keys(q,['enabled','mask','pending','vector','active','cause','frame','entries']);number(q.enabled,1);number(q.mask,7);number(q.pending,7);number(q.vector,65535);number(q.active,1);if(![0,1,2,4].includes(q.cause))throw new TypeError('IRQ 来源无效。');q.entries=stamp(q.entries);
      if(q.enabled&&(q.vector>4092||q.vector%4)||!!q.active!==!!q.frame)throw new TypeError('IRQ 状态无效。');
      if(q.frame){keys(q.frame,['pc']);number(q.frame.pc,4096);if(q.frame.pc%4)throw new TypeError('IRQ 返回地址未对齐。');}
      if(!d.powered&&(timer.next!==null||pwm.next!==null||p.spi.active||p.i2c.active||q.active))throw new TypeError('停电快照仍有扩展事件。');
      d.schema='core8.snapshot/1';delete d.plus;super.importState(d);this.plus=p;return this;
    }
  }
  var timerMain='LDI R0,255\nST R0,0x4000\nLDI R7,1\nLDI R0,128\nST R0,0x4603\nLDI R0,1\nST R0,0x4601\nST R0,0x4600\nLDI R0,232\nST R0,0x4201\nLDI R0,3\nST R0,0x4202\nLDI R0,7\nST R0,0x4200\nidle: WAIT 60000\nJMP idle';
  while(assemble(timerMain).bytes.length<128)timerMain+='\nNOP';
  timerMain+='\nisr: ADD R2,R7\nST R2,0x2000\nST R2,0x4001\nIRET';
  var SAMPLES=[
    {id:'pwm-breath',name:'PWM · 呼吸灯',description:'255 µs 周期，程序每约 5 ms 调整占空时间，实际输出来自 PWM_OUT。',source:'LDI R0,255\nST R0,0x4301\nLDI R0,1\nST R0,0x4300\nLDI R1,0\nLDI R2,5\nLDI R6,1\nLDI R7,250\nloop: ST R1,0x4303\nWAIT 5000\nADD R1,R2\nJZ R1,turn\nMOV R3,R1\nXOR R3,R7\nJNZ R3,loop\nturn: NOT R2\nADD R2,R6\nJMP loop'},
    {id:'timer-irq',name:'定时器 · 中断计数',description:'每 1000 µs 进入中断，RAM[0] 和 GPIO 显示计数，IRET 实际返回主循环。',source:timerMain},
    {id:'spi-register',name:'SPI · 寄存器写入与回读',description:'两字节事务写 reg1=90 再回读，结果驱动 GPIO 并从 UART 发出 Z；需连接模式0的 SPI 从设备。',source:'LDI R0,255\nST R0,0x4000\nLDI R0,1\nST R0,0x4103\nST R0,0x4500\nLDI R0,1\nST R0,0x4501\nWAIT 8\nLDI R0,90\nST R0,0x4501\nWAIT 8\nLDI R0,129\nST R0,0x4501\nWAIT 8\nLDI R0,0\nST R0,0x4501\nWAIT 8\nLD R1,0x4501\nST R1,0x2000\nST R1,0x4001\nST R1,0x4100\nHALT'},
    {id:'i2c-temperature',name:'I²C · 温度寄存器',description:'循环读取 0x48/reg0 温度到 R1/RAM[0]、GPIO 和 UART 原始字节；R2 显示事务状态，错址/断线产生 NACK。',source:'LDI R0,255\nST R0,0x4000\nLDI R0,1\nST R0,0x4103\nST R0,0x4400\nLDI R0,72\nST R0,0x4401\nLDI R0,0\nST R0,0x4402\nloop: LDI R0,1\nST R0,0x4404\nWAIT 100\nLD R1,0x4403\nST R1,0x2000\nST R1,0x4001\nST R1,0x4100\nLD R2,0x4405\nWAIT 10000\nJMP loop'}
  ];
  return {CPU:CPU,assemble:assemble,SAMPLES:SAMPLES,SPI_TIME:SPI_TIME,I2C_TIME:I2C_TIME,NAMES:Base.NAMES.concat('IRET')};
}));
