import React, { useEffect, useState } from 'react';
import api from '@kinvolk/headlamp-plugin/lib/ApiProxy'
const WebProxy: React.FC = () => {
    const [data, setData] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await api.request('/api/v1/namespaces/default/services/test-testwebapp:80/proxy/',{isJSON: false});
                const text = await response.text();
                setData(text);
            } catch (err) {
                setError('Failed to fetch data from Kubernetes API');
                console.log(err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    if (loading) {
        return <div>Loading...</div>;
    }

    if (error) {
        return <div>{error}</div>;
    }

    return (
        <div>
            <h1>Web Proxy</h1>
            <div dangerouslySetInnerHTML={{ __html: data }} />
        </div>
    );
};

export default WebProxy;