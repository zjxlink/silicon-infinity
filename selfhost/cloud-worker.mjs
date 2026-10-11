import {parentPort, workerData} from 'node:worker_threads';
import {openDatabase} from './database.mjs';
import {handleRequest} from '../server/cloud.mjs';

const db = openDatabase(workerData.filename);
// The parent sends only one request at a time. Simulation work never blocks
// the HTTP/authentication event loop, and the database still enforces CAS.
parentPort.on('message', async ({id, request}) => {
  try {
    const response = await handleRequest(new Request(request.url, {
      method: request.method, headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    }), {db});
    parentPort.postMessage({id, response: {
      status: response.status, headers: [...response.headers], body: await response.text(),
    }});
  } catch {
    parentPort.postMessage({id, response: {status: 500, headers: [['content-type', 'application/json']], body: JSON.stringify({error: '服务暂时无法处理此操作，请稍后重试。'})}});
  }
});
parentPort.postMessage({ready: true});
