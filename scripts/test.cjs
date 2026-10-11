'use strict';
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const suites=['circuit','core8','integration','lessons','release-boundaries','chip-library','core8plus','packaging-v2','v2-examples','hardware-v3','builder-mcu','debugger-v3','challenges-v3','cloud-v3','mcu-v4','learning-v4','applications-v4','workspaces-v4','room-client-v4','cloud-v4','manual-chips-v4','manual-mcu-v4','templates-v5','performance-v5','testbench-v5','architecture-v5','systems-v5','cloud-v5','engineering-v6','custom-architecture-v6','campaign-v6','verification-v6','ecosystem-v6','timeline-v7','recorder-v7','milestones-v7','release-v7','custom-cpu-v8','protocol-devices-v8','system-peripherals-v8','studio-v8','cost-v8','cloud-v8','terminal-v8','compute-v9','trace-v9','projects-v9','comparison-v9','scale-v9','release-v9'];
for(const suite of suites){
  process.stdout.write('\n=== '+suite+' ===\n');
  const result=spawnSync(process.execPath,[path.join(root,'tests',suite+'.test.cjs')],{cwd:root,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
process.stdout.write('\nAll test suites passed.\n');
