import '../styles/Modal.css';

export function ModalIconButton({label,children,className='',...props}) {
    return <button type="button" {...props} className={`dialog-icon-button ${className}`} aria-label={label} title={label}>{children}</button>;
}

export default function ModalCloseButton({label='Close dialog',...props}) {
    return <ModalIconButton {...props} label={label} className="modal-close-button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg>
    </ModalIconButton>;
}
