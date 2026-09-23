import ReactDOM from 'react-dom';
import React, { Component } from 'react';
import '../styles/Toast.css';
import errorToastIcon from "../assets/error-toast.png";
import infoToastIcon from "../assets/info-toast.png";
import warningToastIcon from "../assets/warning-toast.png";
import successToastIcon from "../assets/success-toast.png";
import closeToastIcon from "../assets/+_and_x_icon_v2.png";

class Toast extends Component {
    state = {
        toastRef: React.createRef(),
        closeToastRef: React.createRef(),
        closeToastCallbackFunction: this.props.closeToastCallbackFunction,
        //toastMessage: (this.props.toastMessage === null || this.props.toastMessage === undefined) ? "An unknown error occurred. Please try again later!" : this.props.toastMessage,
        toastMessage: this.props.toastMessage || "An unknown error occurred. Please try again later!",
        possition: this.props.possition || "top",
        notificationType: this.props.notificationType || "error",
        notificationDurationInMs: this.props.notificationDurationInMs + 1000 || 3500,
        // notificationDurationInMs: 3500000,
        toastTypeObj: { 
            "error": {
                icon: errorToastIcon,
                color: "#FFB7B6"
            },
            "info": {
                icon: infoToastIcon,
                color: "#B3E6F5"
            },
            "warning": {
                icon: warningToastIcon,
                color: "#FBE7C6"
            },
            "success": {
                icon: successToastIcon,
                color: "#B7F7C4"
            }
        }
    }
    
    componentDidMount(){
        let { possition, toastRef, closeToastRef, toastTypeObj, closeToastCallbackFunction, notificationType, notificationDurationInMs } = this.state;
        let [ toast, closeToast ] = [ toastRef.current, closeToastRef.current ];

        // when the toast is rendered ajust the color of the toast based on the type of notification and set it in the correct possition based on the possition prop passed from the parent component
        toast.style.backgroundColor = toastTypeObj[notificationType].color;
        if(possition.includes("bottom")){
            toast.style.top = "100%";
        }
        if(possition.includes("left")){
            toast.style.left = "2rem";
        }else if(possition.includes("right")){
            toast.style.right = "2rem";
        }else{
            toast.style.transform = "translateX(-50%)";
            toast.style.left = "50%";
        }

        // after the specified duration passed from the props has ran out call the callback function so that the parent component can close (unrender) the toast
        let timerId = setTimeout(() => {
            closeToastCallbackFunction();
        }, notificationDurationInMs);

        closeToast.onclick = (event) => {
            // this code does not work with <React.StrictMode> for some reason... I guess I need to look into <React.StrictMode> to see what it actually does
            // if the user clicks the close button then instead of waiting for the toast to close by itself, close the toast right away
            clearTimeout(timerId);
            closeToastCallbackFunction();
        }
    }

    // we don't do this in the componentDidMount because we want the images that the toast uses to be loaded in fully before showing the toast
    showAndCloseToast = (toast) => {
        let { possition, notificationDurationInMs } = this.state;

        function toastOpen(toast, possition){
            if(possition.includes("top")){
                toast.style.top = "2rem";
            }else if(possition.includes("bottom")){
                toast.style.top = "calc(100% - 100px)";
            }else{
                // if it doesn't include either, default to top
                toast.style.top = "2rem";
            }
        }
        function toastClose(toast, possition){
            if(possition.includes("top")){
                toast.style.top = "-6.5rem";
            }else if(possition.includes("bottom")){
                toast.style.top = "100%";
            }else{
                // if it doesn't include either, default to top
                toast.style.top = "-6.5rem";
            }
        }
        // here we set a 10ms timeout before popping up the toast because otherwise the css property 'transition' doesn't work and spans the element in place instead of smootly animating it (this happens only when you try to anime an element with 'transition' right after the element is rendered, which is the case here).
        setTimeout(() => { toastOpen(toast, possition) }, 10);
        // here we know the duration after which the toast needs to dissappear and we know the duration of the toast open/close animation which is 500ms so we can just calculate after how much time the toast should go back to its original position (offscreen) before being unrendered 
        setTimeout(() => { toastClose(toast, possition) }, notificationDurationInMs - 500);
    }
    
    render() {
        let { toastRef, closeToastRef, toastTypeObj } = this.state;
        const toastMessage = this.props.toastMessage || this.state.toastMessage;
        const notificationType = this.props.notificationType || this.state.notificationType;

        return (
            <div ref={toastRef} className='toast-notification flex'>
                <div className='toast-icon-container'>
                    <img onLoad={() => { this.showAndCloseToast(toastRef.current) }} src={toastTypeObj[notificationType].icon} />
                </div>
                <div style={{ maxWidth: "85%" }}>
                    <div className='toast-text-container flex column' style={{ width: "100%" }}>
                        <label>{notificationType.charAt(0).toUpperCase() + notificationType.slice(1)}</label>
                        <label title={toastMessage}>{toastMessage}</label>
                    </div>
                </div>
                <div ref={closeToastRef} className='toast-icon-container'>
                    <img src={closeToastIcon} />
                </div>
            </div>
        );
    }
}
 
export default Toast;