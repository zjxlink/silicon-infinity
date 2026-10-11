(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./chip-library.js'):root.ChipLibrary);if(typeof module==='object'&&module.exports)module.exports=api;else root.ChipManualV4=api;})(typeof globalThis!=='undefined'?globalThis:this,function(library){
 'use strict';
 const entries=[],portHints={};
 const section=(id,title,paragraphs=[],headers,rows)=>({id,title,paragraphs,...(headers?{table:{headers,rows}}:{})});
 function add(id,title,category,summary,appliesTo,sections,hints){entries.push({id,title,category,summary,appliesTo,sections});for(const model of appliesTo)if(hints)portHints[model]={...hints};}
 add('signals','信号、输入、LED 与上电','入门','先看懂数字、未知态、时钟和供电，再接线。',[],[
  section('values','0 / 1 / X / Z 与数字位宽',['0 和 1 是已知的数字逻辑值。X 是未知或冲突，Z 是当前没有驱动；Z 接入普通逻辑门时按未知处理，不会自动成为 0。','两个有效推挽输出接到同一位，即便都输出 1，也会形成驱动冲突并显示 X。需要输入的控制端应连接明确的 0 或 1。'],['写法','含义'],[['0x04','十六进制 4，与十进制 4 相同'],['0b0100','二进制 4；最右侧为 bit0'],['8 位','可表示无符号 0—255；16 位为 0—65535'],['b0 / lo','b0 是最低位；lo 是 16 位数的低 8 位']]),
  section('inputs','输入开关与 LED / 输出',['输入开关是工程的外部输入，LED / 输出是观察端，不是可编程芯片。点击输入或填写数字改变信号，LED 根据真实收到的值显示状态。','暂停时更改输入先排入事件队列；单步或运行后才生效。刚修改连线需要先“应用并重新启动”。LED 不模拟电流、压降或限流电阻。']),
  section('timing','组合逻辑与时序芯片',['组合逻辑在输入传播稳定后直接得到输出。时序芯片在全局每 1 μs 的下一拍同时采样，再一起更新；一串寄存器不会在同一拍把新值直接传穿。','“暂停”冻结虚拟时间；“复位”是暖复位。暖复位可保留 RAM，而断电再上电会回到冷启动状态。各芯片的 reset 输入与顶部暖复位不一定相同，具体看该芯片手册。']),
  section('wires','接线规则',['数字位宽必须相同；总线拆分/合并使用专门芯片。电源端口、数字端口和协议端口不是同一种线。UART、SPI、I²C 端口只接相同协议。','所有元件都受所属供电域控制；Core8 还需要同一供电域的 VCC/GND 实际接线。普通门和独立模块隐式供电。'])
 ]);
 const gateDefs=[['not','非门','输入取反',null],['and','与门','两个输入都为 1 才为 1',[0,0,0,1]],['or','或门','至少一个输入为 1 即为 1',[0,1,1,1]],['xor','异或门','两个输入不同为 1',[0,1,1,0]],['nand','与非门','与门输出取反',[1,1,1,0]],['nor','或非门','或门输出取反',[1,0,0,0]],['xnor','同或门','两个输入相同为 1',[1,0,0,1]]];
 for(const [id,title,summary,truth]of gateDefs){const unary=id==='not',unknown=['and','nand'].includes(id)?'A 或 B 有确定的 0 时，AND=0、NAND=1；否则未知输入可能使输出 X。':['or','nor'].includes(id)?'A 或 B 有确定的 1 时，OR=1、NOR=0；否则未知输入可能使输出 X。':'输入含 X 或 Z 时输出 X。';add('gate-'+id,title,'逻辑门',summary,['std.'+id+'/1'],[
  section('truth','真值表',['1 位组合逻辑，无寄存器、无参数、无读写副作用。'],unary?['IN','OUT']:['A','B','OUT'],unary?[['0','1'],['1','0']]:truth.map((v,i)=>[String(i>>1),String(i&1),String(v)])),
  section('unknown','未知输入与供电',[unknown,'失电后数字输出为 Z；重新上电后由当前输入重新计算。'])
 ],unary?{in:'1 位输入。0→1，1→0；X/Z→X。',out:'IN 的逻辑反相。'}:{a:'第一个 1 位逻辑输入；见手册真值表。',b:'第二个 1 位逻辑输入；见手册真值表。',out:summary+'。'});}
 add('mux1','二选一选择器','选择与总线','SEL=0 选 A，SEL=1 选 B。',['std.mux/1'],[
  section('select','选择规则',[],['SEL','OUT'],[['0','A'],['1','B'],['X / Z','A、B 都为相同已知 0/1 时保留该值；否则 X']]),
  section('ports','端口与示例',['A、B、SEL、OUT 都是 1 位。输入 A=0、B=1 时，OUT 跟随 SEL。没有存储和复位；失电时 OUT 为 Z。','被选择的数据若是 Z，作为该逻辑门输入会变为 X。'])
 ],{a:'SEL=0 时选用的 1 位输入。',b:'SEL=1 时选用的 1 位输入。',sel:'0 选择 A；1 选择 B；X/Z 仅在 A、B 相同且已知时仍可确定。',out:'选中的输入，经逻辑门接收规则处理。'});
 add('dff','D 触发器','存储与时序','每拍采样 D；RESET 优先，EN 控制保持。',['std.dff/1'],[
  section('update','下一拍的更新规则',['初始 Q=0；顶部暖复位、冷复位和重新上电均使 Q=0。所有控制端应接已知值。'],['RESET','EN','下一拍 Q'],[['1','任意','0'],['0','0','保持原 Q'],['0','1','采样 D，D 为 Z 时记为 X'],['X / Z','任意','X'],['0','X / Z','X']]),
  section('example','接线练习',['D 接输入开关，EN 固定为 1，RESET 固定为 0，Q 接 LED。改变 D 后逐拍观察；把 EN 置 0 后，D 再改变也不会覆盖 Q。'])
 ],{d:'EN=1 时下一拍采样的 1 位数据；Z 被存成 X。',en:'0 保持 Q；1 采样 D。',reset:'同步高有效；1 时下一拍 Q=0，优先于 EN。',q:'当前保存的一位，初始值为 0。'});
 for(const role of ['vcc','gnd'])add('power-'+role,role==='vcc'?'电源正端 VCC':'电源地端 GND','供电','功能供电端口，不是数字常量。',['std.'+role+'/1'],[
  section('connection','怎样连接',[role==='vcc'?'OUT 接 MCU 的 VCC；还需要配套 GND。':'OUT 接 MCU 的 GND；还需要配套 VCC。','电源源头与 MCU 必须属于同一供电域。顶部电源开关控制功能供电，不计算电压和电流。此端口不能连接数字输入；数字 0/1 请使用输入开关或常量元件。'])
 ],{out:role==='vcc'?'电源正端，只接 VCC 电源端口，不是数字 1。':'电源地端，只接 GND 电源端口，不是数字 0。'});
 const aluOps=[['0 / 0x0','传递 B','OUT=B','0'],['1 / 0x1','加法','OUT=(A+B) 的低 W 位','超过无符号最大值时为 1'],['2 / 0x2','减法','OUT=(A−B) 的低 W 位','A≥B 时为 1（没有借位）；A<B 为 0'],['3 / 0x3','按位与','OUT=A AND B','0'],['4 / 0x4','按位或','OUT=A OR B','0'],['5 / 0x5','按位异或','OUT=A XOR B','0'],['6 / 0x6','按位取反','OUT=NOT A，保留 W 位','0'],['7 / 0x7','逻辑左移','OUT=A 左移 k 位的低 W 位','移位前完整结果超过最大值时为 1'],['8 / 0x8','逻辑右移','OUT=A 右移 k 位，高位补 0','0（不记录被移出的位）'],['9 / 0x9','传递 A','OUT=A','0'],['10 / 0xA','乘法','OUT=(A×B) 的低 W 位','完整乘积超过最大值时为 1'],['11 / 0xB','相等比较','A=B 时 OUT=1，否则 0','0'],['12 / 0xC','无符号小于','A<B 时 OUT=1，否则 0','0'],['13 / 0xD','无符号大于','A>B 时 OUT=1，否则 0','0'],['14 / 0xE','未定义','OUT、ZERO、CARRY 均为 X','X'],['15 / 0xF','未定义','OUT、ZERO、CARRY 均为 X','X']];
 for(const width of [8,16]){const max=2**width-1,model=k=>'std.'+k+width+'/1';
  add('alu'+width,width+' 位 ALU','运算','4 位 OP 决定运算；所有数字按无符号处理。',[model('alu')],[
   section('op','OP 每个取值',['这里 W='+width+'，最大值为 '+max+'；OP 码与 Build8 的指令操作码不同。'],['OP（十进制 / 十六进制）','运算','OUT','CARRY'],aluOps),
   section('flags','结果、ZERO 与 CARRY',['OUT 截取低 '+width+' 位，溢出按模 '+(2**width)+' 回绕；没有有符号溢出标志。ZERO=1 表示截断后的 OUT 等于 0，否则为 0。','减法的 CARRY=1 表示没有借位，不能理解为“发生借位”。比较结果是整个总线上的数字 0 或 1，不是全部位都为 1。','左、右移的位数 k=B AND '+(width-1)+'；仅使用 B 的低 '+(width===8?3:4)+' 位。因此 B='+width+' 等价于移动 0 位。']),
   section('unknown','未知输入与未定义操作',['A、B、OP 任一包含 X/Z 时，OUT、ZERO、CARRY 全部为 X；即使该操作数学上不使用 B，也仍要求 B 已知。OP=14/15 未定义。','无状态、无复位、无参数。修改输入并推进事件后组合计算；失电输出 Z。']),
   section('examples','可立即尝试的例子',[],['A','B','OP','OUT','ZERO / CARRY'],[['1','2','4（或）','3','0 / 0'],[String(max),'1','1（加）','0','1 / 1'],['0','1','2（减）',String(max),'0 / 0'],['7','7','11（等于）','1','0 / 0'],['7',String(width),'7（左移）','7','0 / 0']])
  ],{a:width+' 位无符号操作数 A，范围 0—'+max+'。',b:width+' 位无符号操作数 B；移位只取低 '+(width===8?3:4)+' 位。',op:'0传B；1加；2减；3与；4或；5异或；6取反A；7左移；8右移；9传A；10乘；11相等；12小于；13大于；14/15未定义→X。',out:'运算结果低 '+width+' 位；溢出回绕。',zero:'截断后的 OUT=0 时为1，否则0；未知或非法 OP 时为X。',carry:'加法/乘法/左移溢出时1；减法 A≥B 时1（无借位）；其他操作0。'});
  add('zero'+width,width+' 位零比较','运算','判断一条总线是否全为 0。',[model('iszero')],[section('rule','判断规则',[],['IN','ZERO'],[['每一位都为 0','1'],['任一位确定为 1','0，即便其他位未知'],['没有已知 1，但有 X/Z','X']]),section('example','使用',['没有参数或记忆。可将寄存器 Q 接 IN，ZERO 接跳转或完成条件；不要把未知值当作数值 0。'])],{in:'待比较的 '+width+' 位总线。',zero:'全0→1；存在已知1→0；其余含X/Z→X。'});
  add('register'+width,width+' 位寄存器','存储与时序','EN=1 下一拍记住 D；EN=0 保持。',[model('register')],[
   section('ports','端口',[],['端口','含义'],[['D','待存的 '+width+' 位数据'],['EN','0保持，1更新'],['RESET','同步高有效；优先级最高'],['Q','当前已存数据']]),
   section('reset','初值、复位与未知',['参数 initial 范围 0—'+max+'，默认 0；冷启动、暖复位和 RESET=1 的下一拍均恢复 initial，而非一律清零。','RESET 或 EN 为 X/Z 时 Q 变为全 X；EN=1 时逐位存 D，数据 Z 变为 X。RESET=1 仍优先于未知 EN。']),
   section('example','接线练习',['D=42，EN=1，RESET=0，逐拍后 Q=42；将 EN=0 再改变 D，Q 仍保持42。把 initial 改为7并应用，初始 Q=7。'])
  ],{d:'下一拍待存的数据；Z位转为X。',en:'0保持；1写入D；未知会令Q全X。',reset:'1下一拍恢复initial参数，优先于EN；不是顶部暖复位按钮。',q:'当前存储的 '+width+' 位数据。'});
  add('ram'+width,'256 × '+width+' RAM','存储与时序','256 个字；组合读、逐拍写，暖复位保留数据。',[model('ram')],[
   section('ports','端口与操作',[],['端口','意义'],[['ADDRESS','8 位地址，0—255；不是字节偏移'],['DATA',width+' 位写入数据'],['WRITE','1在下一拍写入，0不写；持续为1会每拍写入'],['RESET','1在下一拍恢复 contents 初值，优先于WRITE'],['OUT','当前地址的存储值；读取无副作用'],['FAULT','存在锁存故障时为1；需复位清除']]),
   section('parameters','参数和复位',['contents 最多 256 个 0—'+max+' 的整数；未列的地址填0。顶部暖复位保留全部存储数据并清故障；冷启动/断电再上电/RESET引脚恢复 contents。','ADDRESS 不确定时 OUT=X。写入时 ADDRESS/DATA 含 X/Z，或控制信号不确定时置故障，不覆盖原存储。成功的后续写入不会自行清除已锁存 FAULT。']),
   section('example','读写示例',['ADDRESS=3、DATA=42、WRITE=1、RESET=0，逐拍写入后 OUT=42；将WRITE=0可反复读而不改数据。16位RAM同样只有256个地址，每个地址存一个16位字。'])
  ],{address:'0—255，选择一个存储字；未知地址读出X。',data:'WRITE=1 时在下一拍写入的 '+width+' 位数据。',write:'1每拍写入；0只读；未知置FAULT。',reset:'1下一拍恢复contents初值；顶部暖复位则保留RAM。',out:'组合读取 ADDRESS 所指的数据；读取无副作用。',fault:'锁存故障；合法写入不自动清除，复位清除。'});
  add('rom'+width,'256 × '+width+' ROM','存储与时序','编辑 contents 提供数据或指令，运行中只读。',[model('rom')],[
   section('ports','地址和输出',['ADDRESS 组合选择内容，无写端口、无采样等待。OUT 为 contents[address]，未填写的有效地址返回0。','有效地址始终为0—255；'+(width===16?'16位ROM的ADDRESS虽然有16位，但256—65535均越界。':'8位ROM地址自然处于0—255。')],['状态','OUT','FAULT'],[['有效已知地址','对应数据或默认0','0'],['地址含X/Z或越界','X','1']]),
   section('parameters','contents 与 source',['contents 最多256个 '+width+' 位整数；source 是最多30,000字符的程序文本记录，不会仅因填写它就自动变成指令。使用 Build8 程序编辑器“编译并应用”才能生成对应 words/contents。','ROM没有可写运行状态；复位或重新上电不改变已保存参数。FAULT 是当前地址的组合结果，不是锁存故障。']),
   section('example','读取示例',['contents 填入 [10,20,30] 并应用。ADDRESS=1 时 OUT=20；ADDRESS=3 时 OUT=0。'])
  ],{address:width===16?'16位地址线，但仅0—255有效；越界FAULT=1。':'0—255，选择ROM中的一个字。',out:'contents[address]，未填写有效地址返回0；非法地址X。',fault:'当前地址含X/Z或≥256时1，否则0；不锁存。'});
  add('mux'+width,width+' 位四路选择','选择与总线','2 位 SEL 选择 A/B/C/D 中的一条完整总线。',[model('mux')],[
   section('selection','SEL 编码',[],['SEL','输出 OUT'],[['0 / 0b00','A'],['1 / 0b01','B'],['2 / 0b10','C'],['3 / 0b11','D']]),
   section('unknown','未知态和示例',['SEL 已知时原样传递所选总线，保留其中 X/Z。SEL 含 X/Z 时逐位检查四条输入：只有四条在该位都是相同已知值时保留该值，其余输出X。','这是组合选择器，没有存储、复位或参数。例如 A=10、B=20、C=30、D=40，SEL=2 得到30。'])
  ],{a:'SEL=0选择的总线。',b:'SEL=1选择的总线。',c:'SEL=2选择的总线。',d:'SEL=3选择的总线。',sel:'0→A；1→B；2→C；3→D。',out:'所选总线；SEL未知时仅保留四路共同的已知位。'});
  add('fifo'+width,width+' 位 FIFO 队列','存储与时序','先进先出，所有 PUSH/POP 在下一拍处理。',[model('fifo')],[
   section('ports','端口和容量',['capacity 参数范围1—256，默认16。初始队列为空；暖复位、冷启动、RESET=1均清空队列并清FAULT。'],['端口','含义'],[['DATA',width+' 位待入队数据'],['PUSH','1推入一个值；持续为1每拍推入'],['POP','1弹出原队首；持续为1每拍弹出'],['RESET','1下一拍清空，优先于PUSH/POP'],['OUT','当前队首；空队列为X；读取不弹出'],['EMPTY / FULL','空/满时分别为1'],['COUNT','9位数量，0—capacity'],['FAULT','锁存的满、空或未知控制/数据错误']]),
   section('order','同时推入和弹出',['同一拍先 POP、再 PUSH。满队列同时POP/PUSH，可腾出一个位置再写入；空队列同时操作，会先因POP置空读故障，然后仍可成功PUSH。','满时单独PUSH拒绝新值并置FAULT；空时POP置FAULT。PUSH时DATA未知会拒绝新数据；RESET/PUSH/POP未知会置FAULT。后续成功操作不会自行清FAULT。']),
   section('example','使用示例',['依次让 DATA=65 和66，各PUSH一拍后关PUSH，OUT=65、COUNT=2。POP一拍后 OUT=66、COUNT=1。再POP后EMPTY=1、OUT=X。'])
  ],{data:'PUSH=1时下一拍加入的值。',push:'1每拍推入；与POP同时为1时先弹后推。',pop:'1下一拍移除队首；读取OUT本身不弹出。',reset:'1下一拍清空队列和FAULT，优先级最高。',out:'当前队首；空时X，不因观察而移除。',empty:'COUNT=0时1。',full:'COUNT=capacity时1。',count:'9位当前数量，0—capacity。',fault:'满推入/空弹出/未知控制或数据的锁存错误。'});
  add('constant'+width,width+' 位常量','输入与显示','通过参数提供固定数字，不需要时钟。',[model('constant')],[section('value','value 参数',['范围0—'+max+'，默认0；修改后应用设计，OUT即为设置的数值。没有存储、寄存器或软件地址；失电输出Z。','若希望运行中方便切换，使用工程输入开关；常量适合固定使能、复位和固定地址。'])],{out:'固定输出value参数，范围0—'+max+'；失电Z。'});
 }
 add('split8','8 位拆线','选择与总线','把总线的每一位送到单独端口。',['std.split8/1'],[section('order','位序与示例',['b0为最低位、b7为最高位；IN=0x81时b0=b7=1，其余0。组合传递，逐位保留X/Z；无参数、无记忆。'],['端口','意义'],[['IN','8位输入'],['b0—b7','对应bit0—bit7的1位输出']])],{in:'8位输入总线；b0是最低位。',...Object.fromEntries(Array.from({length:8},(_,i)=>['b'+i,'输入的bit'+i+'，权重'+2**i+'；保留X/Z。']))});
 add('merge8','8 位合线','选择与总线','把八个输入位组合成总线。',['std.merge8/1'],[section('order','位序与示例',['OUT=b0+2×b1+4×b2+…+128×b7（各位已知时）。b0=1、b7=1、其余0得到0x81。组合传递并保留X/Z；无参数、无记忆。'])],{out:'合并b0—b7；b0为最低位，保留X/Z。',...Object.fromEntries(Array.from({length:8},(_,i)=>['b'+i,'输出的bit'+i+'，权重'+2**i+'。']))});
 for(const kind of ['split','merge'])add(kind+'16',kind==='split'?'16 位拆分':'16 位合并','选择与总线','LO 为低8位，HI 为高8位。',['std.'+kind+'16/1'],[section('order','位序与示例',['16位数=LO+256×HI；0x1234对应LO=0x34、HI=0x12。组合传递，保留每一位X/Z，没有端序自动交换或存储。'])],kind==='split'?{in:'16位待拆分输入。',lo:'输入bit0—7。',hi:'输入bit8—15。'}:{lo:'合并结果bit0—7。',hi:'合并结果bit8—15。',out:'LO+256×HI，保留X/Z。'});
 add('display8','字节显示器','输入与显示','显示8位数字及可打印字符；OUT原样透传。',['std.display8/1'],[section('display','显示规则',['IN为8位输入，OUT与IN相同，逐位保留X/Z。没有串口协议或可写寄存器；显示字符只是对当前字节的解释。','例如65=0x41，可解释为ASCII字母A。需要保存字节时在前面接寄存器；仅观察不会改变任何信号。'])],{in:'待显示的8位数值/ASCII字节。',out:'IN原样透传，保留X/Z，不存储。'});
 add('pc16','16 位程序计数器','处理器模块','下一拍加一或载入跳转目标；HALT后需复位。',['std.pc16/1'],[
  section('priority','采样优先级',['initial参数为0—65535，默认0；暖复位、冷启动或RESET=1恢复initial并解除停止。复位优先于停止。下表运行状态要求其他所需控制均已知；未知控制规则见下一节。'],['条件','下一拍行为'],[['已停止且未复位','继续保持'],['HALT=1','停止；保持当前值'],['EN=0','保持当前值'],['EN=1，LOAD=0','OUT加1，65535之后回到0'],['EN=1，LOAD=1','OUT载入TARGET']]),
  section('fault','未知控制',['尚未停止时，RESET/HALT/EN未知，或EN=1而LOAD未知，令OUT=X并锁存停止；这项检查先于HALT=1，所以HALT=1但EN=X也会输出X。选择载入时TARGET未知、加一时当前PC未知也会停止。','已经停止时保持原值，未知控制不会再次污染Q；明确的RESET=1或顶部复位才会解除停止。'])
 ],{en:'0保持；1按LOAD选择加1或跳转。',load:'EN=1时：0加1，1载入TARGET。',target:'LOAD=1时载入的16位地址。',halt:'1下一拍停止，需复位解除。',reset:'1下一拍恢复initial并解除停止。',out:'当前16位地址，不是存储器内容。',halted:'停止后1，复位后0。'});
 add('fetch-execute1','取指 / 执行控制','处理器模块','两相交替，让ROM取指与寄存器执行分开。',['std.fetch-execute/1'],[
  section('phases','相位',['初始FETCH=1、EXECUTE=0；每1μs且未停止时交替，因此一条Build8指令通常两拍。全部数据通路必须接到这些真实控制信号。','HALT=1的下一拍进入停止，FETCH=EXECUTE=0、HALTED=1，需复位解除。RESET=1优先；未知RESET/HALT也会停止并报告故障。暖/冷复位恢复取指相位。'])
 ],{halt:'1下一拍停止相位翻转；需复位解除。',reset:'1恢复取指相位，解除停止。',fetch:'取指相位1；停止时0。',execute:'执行相位1；停止时0。',halted:'当前是否已经停止。'});
 add('terminal','串口终端','通信设备','TX/RX交叉接线，发送与接收真实字节事务。',['io.terminal/1'],[
  section('connection','端口与时序',['终端TX→MCU UART_RX；MCU UART_TX→终端RX。固定9600、8N1，每个字节1042μs；不是可直接接LED的数字线。','在终端输入框发送字符会排入发送队列。发送容量16字节，包含在途字节；满队列拒绝继续加入。MCU需要开启RX，接线及接收端供电在整个事务期间必须有效。']),
  section('history','显示与复位',['接收记录来自实际成功交付；字节可按数字或ASCII理解，非打印字节不是没有收到。历史最多1024条。暖复位/断电取消待发送事务并保留历史标记；重新上电不会补发已取消字节。','终端没有MMIO地址或可编程指令；MCU侧TX/RX数据寄存器请查对应型号的MCU手册。'])
 ],{TX:'发送端，接MCU UART_RX；每字节1042μs，队列16。',RX:'接收端，接MCU UART_TX；显示实际收到的字节。'});
 add('spi-register','SPI 寄存器芯片','通信设备','mode0、16个字节寄存器，使用固定两字节读写帧。',['std.spi-register/1'],[
  section('registers','寄存器和帧',['RX接MCU SPI_OUT；回复通过同一事务返回主控制器。没有单独的MISO/CS/SCLK引脚；这是事务级教学协议。寄存器0—15均8位读写，初始和暖/冷复位均为0。'],['阶段','写寄存器','读寄存器'],[['第1字节','0x00 | 寄存器编号','0x80 | 寄存器编号'],['第1字节回复','0','0'],['第2字节','要写入的数据','任意dummy，例如0'],['第2字节回复','写入后的值','目标寄存器值']]),
  section('errors','限制和复位',['只支持SPI mode0；第1字节bits4—6必须为0。每字节8μs，两字节完成一次访问。第一次已完成的选择会保留到第2字节，读/写完成后清除选择状态。','错误模式、错误帧或断线会令主机报告失败，不应把旧DATA当新读取。只复位MCU不会撤销已经完成的从端字节；若要恢复半帧，复位整板以清除从端选择。']),
  section('example','写后读回90',['依次发送 0x01、0x5A，把寄存器1写为90；再发送0x81、0x00，最后一字节的返回值为0x5A。每发一字节应等待主控制器BUSY清除，并检查ERROR。'])
 ],{RX:'接SPI_OUT。mode0；首字节0x0r写/0x8r读，次字节数据/dummy；每字节8μs。'});
 add('i2c-temperature','I²C 温度传感器','通信设备','7位地址0x48，温度、器件ID、可写暂存三个寄存器。',['std.i2c-temperature/1'],[
  section('registers','寄存器表',['RX接MCU I2C_OUT。主机ADDR填写7位地址0x48，不要先左移成0x90。一次完整寄存器读/写100μs。'],['寄存器','权限','复位值','行为'],[['0 / 0x00','只读','25','环境温度，整数0—125℃；在事务完成时读取'],['1 / 0x01','只读','0xA1','固定器件ID'],['2 / 0x02','读写','0','8位scratch暂存，可写0—255']]),
  section('errors','错误、更新与复位',['错误地址、寄存器不在0—2、写只读寄存器均返回NACK，不产生写入。主机应检查BUSY/DONE/NACK或ERROR，不把保留的旧DATA当作新测量。','温度在观察面板由环境输入更改；暂停时输入需推进后生效。暖复位/冷启动恢复温度25和scratch=0。断线再接回不能使已取消事务重新交付。']),
  section('example','最小读流程',['在对应MCU手册查I²C基地址。先使能控制器，设置ADDR=0x48、REG=0，再向CMD写1；等待完成并确认无错误，最后读取DATA，默认得到25。写scratch时REG=2、DATA=值、CMD=2。'])
 ],{RX:'接I2C_OUT；7位地址0x48；reg0温度RO、reg1 ID0xA1 RO、reg2暂存RW；100μs/次。'});
 if(library)for(const spec of library.list){add('library-'+spec.id,spec.name+' · 结构芯片原版','结构芯片',spec.description,[],[
  section('operation','原版行为',[spec.usage,'这是标准库原版说明；结构可以打开并修改，修改后的功能应以当前内部电路为准。']),
  section('ports','接口',[],['端口','方向','意义'],spec.ports.map(p=>[p.id,p.direction==='in'?'输入':'输出',p.name+'；1位'])),
  section('timing','时序与边界',[spec.sequential?'由内部D触发器保存状态；全局每1μs同时采样。EN=0保持内部状态；RESET=1下一拍清零，优先于EN。':'由内部组合逻辑门计算，没有可编程寄存器或等待周期。','多位数的编号0均为最低位；未连接或冲突不能当作0。可以用“打开内部”查看每个端口真实连接，再保存自己的修订。'])
 ]);}
 return {entries,portHints,aluOps};
});
