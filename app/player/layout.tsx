import { Metadata } from 'next';

export const metadata: Metadata = {
    referrer: 'no-referrer',
};

export default function PlayerLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            {/* Google Cast SDK - only needed on player page */}
            <script
                src="https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1"
                async
            />
            {children}
        </>
    );
}
