import { Hono } from 'hono';
import { register } from '../metrics/prometheus.js';

const metricsRouter = new Hono();

// GET /metrics - Prometheus 格式指标
metricsRouter.get('/metrics', async (c) => {
  try {
    const metrics = await register.metrics();
    c.header('Content-Type', 'text/plain; version=0.0.4');
    return c.body(metrics);
  } catch (error) {
    console.error('Metrics export error:', error);
    return c.text('Error exporting metrics', 500);
  }
});

// GET /metrics/json - JSON 格式指标（便于调试）
metricsRouter.get('/metrics/json', async (c) => {
  try {
    const metrics = await register.getMetricsAsJSON();
    return c.json(metrics);
  } catch (error) {
    console.error('Metrics JSON export error:', error);
    return c.json({ error: 'Error exporting metrics' }, 500);
  }
});

// GET /health/metrics - 指标系统健康检查
metricsRouter.get('/health/metrics', async (c) => {
  try {
    const metrics = await register.getMetricsAsJSON();
    const count = metrics.length;
    
    return c.json({
      status: 'ok',
      metrics_count: count,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return c.json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export { metricsRouter };
