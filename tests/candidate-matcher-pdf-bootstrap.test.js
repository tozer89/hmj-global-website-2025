const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

async function withFreshCandidateMatcherCore(mocks, run) {
  const targetPath = require.resolve('../lib/candidate-matcher-core.js');
  const originalLoad = Module._load;
  delete require.cache[targetPath];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      const mock = mocks[request];
      return typeof mock === 'function' ? mock(request, parent, isMain) : mock;
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    const core = require(targetPath);
    return await run(core);
  } finally {
    Module._load = originalLoad;
    delete require.cache[targetPath];
  }
}

test('extractCandidateDocuments retries pdf-parse after worker bootstrap when DOMMatrix blocks the first load', async () => {
  let pdfParseLoadCount = 0;
  let configuredWorkerSrc = '';

  class FakePDFParse {
    constructor(options) {
      this.options = options;
    }

    static setWorker(workerSrc) {
      if (typeof workerSrc === 'string' && workerSrc) {
        configuredWorkerSrc = workerSrc;
      }
      return configuredWorkerSrc;
    }

    async getText() {
      return {
        text: 'Jane Candidate\nSenior Project Planner\nData Centres\n',
        total: 1,
      };
    }

    async destroy() {}
  }

  await withFreshCandidateMatcherCore({
    'pdf-parse': () => {
      pdfParseLoadCount += 1;
      if (pdfParseLoadCount === 1) {
        const error = new Error('DOMMatrix is not defined');
        error.code = 'pdf_bootstrap_failed';
        throw error;
      }
      return { PDFParse: FakePDFParse };
    },
    'pdf-parse/worker': {
      getData: () => 'data:text/javascript;base64,ZmFrZS13b3JrZXI=',
      getPath: () => '/tmp/pdf.worker.mjs',
    },
  }, async (core) => {
    const result = await core.extractCandidateDocuments([{
      id: 'doc-bootstrap',
      name: 'candidate.pdf',
      extension: 'pdf',
      contentType: 'application/pdf',
      size: 128,
      status: 'ready',
      buffer: Buffer.from('%PDF-1.4\n% bootstrap test', 'utf8'),
      storageKey: '',
      extractedText: '',
      extractedTextLength: 0,
      error: '',
    }], {
      enablePdfOcr: false,
    });

    assert.equal(pdfParseLoadCount, 2);
    assert.match(configuredWorkerSrc, /^data:text\/javascript;base64,/);
    assert.equal(result.successCount, 1);
    assert.equal(result.documents[0].status, 'ok');
    assert.match(result.documents[0].extractedText, /Jane Candidate/);
  });
});
