# Sentry Error Tracking Setup

This application is integrated with Sentry for comprehensive error tracking and performance monitoring.

## Configuration

1. **Create a Sentry Account**
   - Go to [sentry.io](https://sentry.io) and create an account
   - Create a new project for "Next.js"

2. **Set Environment Variables**
   ```bash
   # Copy the example environment file
   cp .env.example .env.local
   
   # Add your Sentry DSN from the Sentry project settings
   NEXT_PUBLIC_SENTRY_DSN=https://your-dsn@sentry.io/project-id
   
   # Optional: Set release version
   NEXT_PUBLIC_SENTRY_RELEASE=stellar-payment-frontend@1.0.0
   ```

3. **Restart the Development Server**
   ```bash
   npm run dev
   ```

## Features

### Automatic Error Capture
- **React Errors**: Component crashes are caught by the ErrorBoundary
- **Uncaught Exceptions**: JavaScript errors are automatically captured
- **Network Errors**: Failed API requests are tracked
- **Performance Issues**: Slow transactions and rendering issues

### Manual Error Reporting
Use the `useErrorReporting` hook for custom error tracking:

```tsx
import { useErrorReporting } from '@/lib/useErrorReporting';

function MyComponent() {
  const { reportError, reportMessage, addBreadcrumb } = useErrorReporting();
  
  const handleError = async () => {
    try {
      await riskyOperation();
    } catch (error) {
      reportError(error, {
        component: 'MyComponent',
        action: 'riskyOperation'
      });
    }
  };
  
  return <button onClick={handleError}>Try Something</button>;
}
```

### Error Context
Each error includes:
- **User Agent**: Browser and device information
- **URL**: Page where error occurred
- **Timestamp**: When the error happened
- **Component Stack**: React component hierarchy
- **Environment**: Development/production status

### Error Reference IDs
When errors occur, users see a reference ID that can be used to:
- Track the specific error in Sentry
- Correlate user reports with technical details
- Debug issues more efficiently

## Privacy & Security

- **Sensitive Data Filter**: Headers, cookies, and query parameters are automatically filtered
- **Local Development**: Debug mode enabled in development for easier testing
- **Controlled Sampling**: Configurable sampling rates for performance monitoring

## Viewing Errors

1. Go to your Sentry project dashboard
2. Filter by environment (development/production)
3. Search by error reference ID from user reports
4. View detailed stack traces and context

## Production Deployment

For production deployments:
1. Set `NEXT_PUBLIC_SENTRY_DSN` in your hosting environment
2. Configure appropriate sampling rates
3. Set up alerts for critical errors
4. Monitor error trends and performance
