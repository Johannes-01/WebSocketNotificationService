/**
 * Metric Collector Lambda
 * Receives client-side metrics and logs them to CloudWatch
 */

exports.handler = async (event) => {
  console.log('Received metrics event:', JSON.stringify(event, null, 2));

  try {
    // Parse request body
    const metrics = JSON.parse(event.body || '{}');

    // Validate required fields
    if (!metrics.metricName || metrics.value === undefined) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Missing required fields: metricName and value are required',
        }),
      };
    }

    // Log structured metrics for CloudWatch metric filter
    console.log(JSON.stringify({
      event_type: 'client_metric',
      metric_name: metrics.metricName,
      metric_value: parseFloat(metrics.value),
      client_id: metrics.clientId || 'unknown',
      timestamp: new Date().toISOString(),
      metadata: metrics.metadata || {},
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        message: 'Metric recorded successfully',
        metricName: metrics.metricName,
      }),
    };
  } catch (error) {
    console.error('Error processing metric:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Failed to record metric',
        details: error.message,
      }),
    };
  }
};
