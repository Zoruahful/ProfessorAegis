const http = require('http');
const {
  ANALYZER_VERSION,
  buildWeaknessReportFromTeam,
  cleanText,
  looksLikeTeamExport,
} = require('./benchmarkAnalyzer');

const WORKER_VERSION = '2026.04.08-worker-v2';
const PORT = Number(process.env.BENCHMARK_WORKER_PORT || 8787);
const HOST = String(process.env.BENCHMARK_WORKER_HOST || '127.0.0.1');

const jobs = new Map();
let nextJobId = 1;

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error('Worker received invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function summarizeJobCounts() {
  const summary = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };

  for (const job of jobs.values()) {
    if (summary[job.status] !== undefined) {
      summary[job.status] += 1;
    }
  }

  return summary;
}

function createJob({ userId, teamExport }) {
  const jobId = `worker-job-${Date.now()}-${nextJobId++}`;
  const submittedAt = new Date().toISOString();

  const job = {
    jobId,
    userId,
    status: 'queued',
    submittedAt,
    startedAt: null,
    completedAt: null,
    error: null,
    report: null,
  };

  jobs.set(jobId, job);

  setTimeout(() => {
    const current = jobs.get(jobId);
    if (!current || current.status !== 'queued') return;
    current.status = 'running';
    current.startedAt = new Date().toISOString();

    setTimeout(() => {
      const latest = jobs.get(jobId);
      if (!latest || (latest.status !== 'queued' && latest.status !== 'running')) return;

      try {
        latest.report = buildWeaknessReportFromTeam(teamExport);
        latest.status = 'completed';
        latest.completedAt = new Date().toISOString();
      } catch (error) {
        latest.status = 'failed';
        latest.completedAt = new Date().toISOString();
        latest.error = error?.message || 'BenchMark worker failed to build the report.';
      }
    }, 150);
  }, 50);

  return job;
}

function serializeJob(job) {
  return {
    ok: true,
    mode: 'http',
    workerVersion: WORKER_VERSION,
    analyzerVersion: ANALYZER_VERSION,
    jobId: job.jobId,
    status: job.status,
    submittedAt: job.submittedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    report: job.report,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (req.method === 'GET' && requestUrl.pathname === '/health') {
      writeJson(res, 200, {
        ok: true,
        statusText: 'BenchMark local worker ready',
        detailText: `Listening on http://${HOST}:${PORT}`,
        workerVersion: WORKER_VERSION,
        analyzerVersion: ANALYZER_VERSION,
        jobCounts: summarizeJobCounts(),
      });
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/jobs/weakness-report') {
      const body = await readJsonBody(req);
      const userId = cleanText(body?.user_id);
      const teamExport = cleanText(body?.team_export);

      if (!userId) {
        writeJson(res, 400, { error: 'user_id is required.' });
        return;
      }

      if (!looksLikeTeamExport(teamExport)) {
        writeJson(res, 400, { error: 'That does not look like a valid Pokémon Showdown export.' });
        return;
      }

      const job = createJob({ userId, teamExport });
      writeJson(res, 200, {
        ok: true,
        mode: 'http',
        workerVersion: WORKER_VERSION,
        analyzerVersion: ANALYZER_VERSION,
        jobId: job.jobId,
        status: job.status,
        submittedAt: job.submittedAt,
      });
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname.startsWith('/jobs/')) {
      const jobId = decodeURIComponent(requestUrl.pathname.slice('/jobs/'.length));
      const job = jobs.get(jobId);

      if (!job) {
        writeJson(res, 404, { error: 'BenchMark job was not found.' });
        return;
      }

      writeJson(res, 200, serializeJob(job));
      return;
    }

    writeJson(res, 404, { error: 'Worker route not found.' });
  } catch (error) {
    writeJson(res, 500, { error: error?.message || 'BenchMark worker crashed.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[BenchMark Worker] Listening on http://${HOST}:${PORT}`);
});
