import type { ReactNode } from 'react';
import { Redirect, Route, Switch, useRouteMatch } from 'react-router-dom';
import Spacings from '@commercetools-uikit/spacings';
import ReportCatalogue from './components/report-catalogue';
import ReportViewer from './components/report-viewer';
import DatasourceAdmin from './components/datasource-admin';
import ReportBuilder from './components/report-builder';

type ApplicationRoutesProps = {
  children?: ReactNode;
};

/**
 * Routes are composed from `useRouteMatch`, never hardcoded, because the application is
 * mounted under `/:projectKey/:entryPointUriPath` and both segments vary.
 *
 * Authorisation is NOT enforced here. The shell already gates on the View permission, and
 * everything that matters is re-decided server-side by the gateway from the verified
 * session — hiding a route in the client would be presentation, not security.
 */
const ApplicationRoutes = (_props: ApplicationRoutesProps) => {
  const match = useRouteMatch();

  return (
    <Spacings.Inset scale="l">
      <Switch>
        <Route path={`${match.path}/catalogue`}>
          <ReportCatalogue />
        </Route>
        <Route path={`${match.path}/reports/:reportId`}>
          <ReportViewer />
        </Route>
        <Route path={`${match.path}/builder`}>
          <ReportBuilder />
        </Route>
        <Route path={`${match.path}/data-sources`}>
          <DatasourceAdmin />
        </Route>
        <Route>
          <Redirect to={`${match.url}/catalogue`} />
        </Route>
      </Switch>
    </Spacings.Inset>
  );
};
ApplicationRoutes.displayName = 'ApplicationRoutes';

export default ApplicationRoutes;
