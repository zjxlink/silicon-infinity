/* No DOM and no network APIs beyond loading the same-origin, immutable engine scripts. */
'use strict';
// Legacy Core8 bundles publish through window; this alias supplies no DOM capabilities.
self.window=self;
importScripts('core8.js','core8plus.js','hardware-v3.js','mcu-v4.js','architecture-v5.js','systems-v5.js','custom-architecture-v6.js','custom-cpu-v8.js','protocol-devices-v8.js','system-peripherals-v8.js','circuit.js','testbench-v5.js','verification-v6.js','compute-v9.js');
const computeHost=new ComputeV9.Host();
self.onmessage=event=>computeHost.handle(event.data,message=>self.postMessage(message));
self.postMessage({type:'ready',protocol:ComputeV9.PROTOCOL,engineVersion:CircuitLab.VERSION});
