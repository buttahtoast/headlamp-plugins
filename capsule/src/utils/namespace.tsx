import { useEffect } from 'react';
import { useDispatch } from 'react-redux';

export function NamespaceSetter({ namespaces }: { namespaces: string[] }) {
  const dispatch = useDispatch();

  useEffect(() => {
    if (namespaces && namespaces.length > 0) {
      dispatch({ type: 'filter/setNamespaceFilter', payload: namespaces });
    }
  }, [dispatch, namespaces]); // Add namespaces to dependencies

  return null; // This component doesn't render anything
}
