import React, { useState, useEffect } from 'react';
import '../styles/Modal.css';

/**
 * A modern, accessible, and reusable Modal component.
 *
 * @param {object} props - The component props.
 * @param {boolean} props.isOpen - Controls whether the modal is open or closed.
 * @param {Function} props.onClose - Callback function to be invoked to close the modal.
 * @param {Function} [props.onOpen] - Optional callback function to run when the modal opens.
 * @param {boolean} [props.closeOnHover] - If true, adds a section that closes the modal on hover.
 * @param {React.ReactNode} props.children - The content to be displayed inside the modal.
 * @returns {React.ReactPortal|null} The modal portal or null if not open.
 */
const Modal = ({ isOpen, onClose, onOpen, closeOnHover = false, className = "", children }) => {
  const [isClosing, setIsClosing] = useState(false);

  // Effect to handle the onOpen callback
  useEffect(() => {
    if (isOpen && !isClosing) {
      onOpen?.(); // Safely call onOpen if it exists
    }
  }, [isOpen, isClosing, onOpen]);

  // Effect to handle closing with the 'Escape' key
  useEffect(() => {
    const handleEscKey = (event) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleEscKey);
    }

    // Cleanup function to remove the event listener
    return () => {
      window.removeEventListener('keydown', handleEscKey);
    };
  }, [isOpen, onClose]);


  // Initiates the closing animation
  const handleClose = () => {
    if (!onClose) return;
    setIsClosing(true);
  };

  // Called when the fade-out transition completes
  const handleTransitionEnd = () => {
    console.log("the overlay has been made invisible. isClosing: ", isClosing);
    if (isClosing) {
      setIsClosing(false);
      onClose(); // Call the parent's close handler
    }
  };

  // Render nothing if the modal is not supposed to be visible
  if (!isOpen && !isClosing) {
    return null;
  }

  return (
    <div
      className={`modal-overlay ${isOpen && !isClosing ? 'fade-in' : 'fade-out'}`}
      // Close modal when clicking the overlay, but not the content
      onClick={handleClose}
      onTransitionEnd={handleTransitionEnd}>
      <div
        className={`modal-container ${className}`}
        // Stop clicks inside the modal from closing it
        onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          {children}
        </div>

        {closeOnHover && (
          <div className="close-modal-on-hover" onMouseEnter={handleClose}>
            <label>Hover to close</label>
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;