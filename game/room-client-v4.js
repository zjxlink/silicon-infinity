(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RoomClientV4=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const copy=x=>JSON.parse(JSON.stringify(x));
 class Delivery {
  constructor({clientId,roomId,user,storage,key,hash,send,read,onSync,onDelivered}){Object.assign(this,{clientId,roomId,user,storage,key,hash,send,read,onSync,onDelivered});this.sequence=0;this.epoch=1;this.pending=null;this.working=false;this.receiptKey=hash([user,clientId]);try{const raw=storage?.getItem(key);if(raw){const p=JSON.parse(raw);if(p.clientId===clientId&&Number.isSafeInteger(p.sequence)&&p.sequence>0&&Number.isSafeInteger(p.epoch)&&p.epoch>0&&p.operation&&typeof p.operation.kind==='string')this.pending=p;}}catch{}}
  remember(packet){if(packet){const value=copy(packet);this.storage?.setItem(this.key,JSON.stringify(value));this.pending=value;}else{try{this.storage?.removeItem(this.key);}catch{}this.pending=null;}}
  receipt(data){return data.clients?.[this.receiptKey];}
  async accept(data){this.sequence=Math.max(this.sequence,this.receipt(data)?.sequence||0);this.epoch=data.epoch;await this.onSync?.(data);return data;}
  async delivered(data,packet){this.remember(null);await this.onDelivered?.(packet.operation,data);return this.accept(data);}
  async transmit(){const packet=this.pending;if(!packet)return null;try{const data=await this.send(copy(packet));return await this.delivered(data,packet);}catch(error){if(error.status&&error.status<500)this.remember(null);throw error;}}
  async submit(operation){if(this.working)throw Error('上一项操作尚未确认');if(this.pending)throw Error('正在恢复上次操作，请等待重新连接');this.working=true;try{this.remember({clientId:this.clientId,sequence:this.sequence+1,epoch:this.epoch,operation:copy(operation)});return await this.transmit();}finally{this.working=false;}}
  async refresh(){if(this.working)return null;this.working=true;try{const data=await this.read();if(!this.pending)return await this.accept(data);const packet=this.pending,receipt=this.receipt(data);if(receipt&&receipt.sequence>=packet.sequence){if(receipt.sequence===packet.sequence&&receipt.hash===this.hash(packet))return await this.delivered(data,packet);this.remember(null);await this.accept(data);throw Error('此客户端已出现其他操作；已同步最新状态，请重新确认设计');}await this.accept(data);if(data.epoch!==packet.epoch){this.remember(null);throw Error('共享运行已进入新阶段，上次未确认的操作没有重放');}return await this.transmit();}catch(error){if(error.status===403||error.status===404)this.remember(null);throw error;}finally{this.working=false;}}
 }
 return {Delivery};
});
