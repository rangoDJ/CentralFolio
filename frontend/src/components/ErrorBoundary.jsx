import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', borderRadius: '12px', background: '#451f1f', border: '1px solid #d93838', color: '#ffcccc', margin: '10px 0', fontFamily: 'Inter, sans-serif' }}>
          <h4 style={{ margin: '0 0 10px 0' }}>Widget Offline</h4>
          <p style={{ fontSize: '0.85rem', margin: 0, opacity: 0.8 }}>{this.state.error?.message || 'Component failed to render.'}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
