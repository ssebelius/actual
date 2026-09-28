import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useResponsive } from '@actual-app/components/hooks/useResponsive';

import { useIsTestEnv } from '#hooks/useIsTestEnv';
import { useLocalPref } from '#hooks/useLocalPref';
import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';

import { TOUR_OFFER_NOTIFICATION_ID, useTour } from './TourProvider';

export function TourAutoOffer() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { isNarrowWidth } = useResponsive();
  const isTestEnv = useIsTestEnv();
  const { pathname } = useLocation();
  const { startTour } = useTour();
  const [introSeen, setIntroSeen] = useLocalPref('tour.introSeen');
  const hasOffered = useRef(false);
  const isInSetup = pathname === '/setup';

  useEffect(() => {
    if (
      hasOffered.current ||
      introSeen ||
      isNarrowWidth ||
      isTestEnv ||
      isInSetup
    ) {
      return;
    }
    hasOffered.current = true;
    dispatch(
      addNotification({
        notification: {
          id: TOUR_OFFER_NOTIFICATION_ID,
          type: 'message',
          sticky: true,
          title: t('Welcome to {{appName}}!', { appName: 'Actual' }),
          message: t(
            'New to {{appName}}? Take a short tour to learn how budgeting works and find your way around.',
            { appName: 'Actual' },
          ),
          button: {
            title: t('Take the tour'),
            action: () => startTour(),
          },
          onClose: () => setIntroSeen(true),
        },
      }),
    );
  }, [
    dispatch,
    introSeen,
    isInSetup,
    isNarrowWidth,
    isTestEnv,
    setIntroSeen,
    startTour,
    t,
  ]);

  return null;
}
