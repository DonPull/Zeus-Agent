import React from 'react';

export default class UiErrorBoundary extends React.Component {
    state={error:null};
    static getDerivedStateFromError(error){return {error};}
    componentDidCatch(error,info){console.error('Zeus display error',error,info.componentStack);}
    render(){
        if(!this.state.error)return this.props.children;
        return <div className="ui-error-panel column gap-15" role="alert">
            <strong>Zeus encountered a display error.</strong>
            <p>Close this panel or reload the interface to recover. Your conversations remain stored by the backend.</p>
            <details><summary>Error details</summary><pre>{String(this.state.error?.message||this.state.error)}</pre></details>
            <button className="settings-button" type="button" onClick={()=>{
                if(this.props.onRecover)this.props.onRecover();else window.location.reload();
            }}>{this.props.onRecover?'Close panel':'Reload interface'}</button>
        </div>;
    }
}
