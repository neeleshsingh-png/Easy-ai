import React from 'react';

interface EasyAiLogoProps {
  size?: number;
  className?: string;
}

export const EasyAiLogo: React.FC<EasyAiLogoProps> = ({ size = 28, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="2"
        y="2"
        width="32"
        height="32"
        rx="9"
        className="fill-teal-600 dark:fill-teal-500"
      />
      <path
        d="M11 18C11 14.134 14.134 11 18 11C21.866 11 25 14.134 25 18"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M14.2 21.8C15.15 23.13 16.5 24 18 24C19.5 24 20.85 23.13 21.8 21.8"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="18" cy="17.5" r="2.2" fill="white" />
    </svg>
  );
};
