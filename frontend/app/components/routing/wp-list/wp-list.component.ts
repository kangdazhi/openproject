// -- copyright
// OpenProject is a project management system.
// Copyright (C) 2012-2015 the OpenProject Foundation (OPF)
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 3.
//
// OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
// Copyright (C) 2006-2013 Jean-Philippe Lang
// Copyright (C) 2010-2013 the ChiliProject Team
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
//
// See doc/COPYRIGHT.rdoc for more details.
// ++

import {Component, OnDestroy, OnInit} from '@angular/core';
import {StateService} from '@uirouter/angularjs';
import {scopeDestroyed$, scopedObservable} from '../../../helpers/angular-rx-utils';
import {debugLog} from '../../../helpers/debug_output';
import {QueryResource} from '../../api/api-v3/hal-resources/query-resource.service';
import {LoadingIndicatorService} from '../../common/loading-indicator/loading-indicator.service';
import {States} from '../../states.service';
import {WorkPackageQueryStateService} from '../../wp-fast-table/state/wp-table-base.service';
import {WorkPackageTableColumnsService} from '../../wp-fast-table/state/wp-table-columns.service';
import {WorkPackageTableFiltersService} from '../../wp-fast-table/state/wp-table-filters.service';
import {WorkPackageTableGroupByService} from '../../wp-fast-table/state/wp-table-group-by.service';
import {WorkPackageTablePaginationService} from '../../wp-fast-table/state/wp-table-pagination.service';
import {WorkPackageTableRelationColumnsService} from '../../wp-fast-table/state/wp-table-relation-columns.service';
import {WorkPackageTableSortByService} from '../../wp-fast-table/state/wp-table-sort-by.service';
import {WorkPackageTableSumService} from '../../wp-fast-table/state/wp-table-sum.service';
import {WorkPackageTableTimelineService} from '../../wp-fast-table/state/wp-table-timeline.service';
import {WorkPackagesListChecksumService} from '../../wp-list/wp-list-checksum.service';
import {WorkPackagesListService} from '../../wp-list/wp-list.service';
import {WorkPackageTableRefreshService} from '../../wp-table/wp-table-refresh-request.service';
import {WorkPackageTableHierarchiesService} from './../../wp-fast-table/state/wp-table-hierarchy.service';


@Component({
  selector: 'wp-list'
})
export class WorkPackagesListComponent implements OnInit, OnDestroy {

  projectIdentifier = this.$state.params['projectPath'] || null;
  text = {
    'jump_to_pagination': this.I18n.t('js.work_packages.jump_marks.pagination'),
    'text_jump_to_pagination': this.I18n.t('js.work_packages.jump_marks.label_pagination')
  };

  constructor(readonly $scope:any,
              readonly $state:StateService,
              readonly AuthorisationService:any,
              readonly states:States,
              readonly wpTableRefresh:WorkPackageTableRefreshService,
              readonly wpTableColumns:WorkPackageTableColumnsService,
              readonly wpTableSortBy:WorkPackageTableSortByService,
              readonly wpTableGroupBy:WorkPackageTableGroupByService,
              readonly wpTableFilters:WorkPackageTableFiltersService,
              readonly wpTableSum:WorkPackageTableSumService,
              readonly wpTableTimeline:WorkPackageTableTimelineService,
              readonly wpTableHierarchies:WorkPackageTableHierarchiesService,
              readonly wpTableRelationColumns:WorkPackageTableRelationColumnsService,
              readonly wpTablePagination:WorkPackageTablePaginationService,
              readonly wpListService:WorkPackagesListService,
              readonly wpListChecksumService:WorkPackagesListChecksumService,
              readonly loadingIndicator:LoadingIndicatorService,
              readonly I18n:op.I18n) {
  }

  ngOnInit() {
    const loadingRequired = this.wpListChecksumService.isUninitialized();

    // Listen to changes on the query state objects
    this.setupQueryObservers();

    //  Require initial loading of the list if not yet done
    if (loadingRequired) {
      this.wpTableRefresh.clear('Impending query loading.');
      this.loadQuery();
    }

    // Listen for refresh changes
    this.setupRefreshObserver();
  }

  ngOnDestroy():void {
    wpTableRefresh.clear('Table controller scope destroyed.');
  }

  private setupQueryObservers() {
    states.tableRendering.onQueryUpdated.values$().pipe()
      .take(1)
      .subscribe(() => $scope.tableInformationLoaded = true);

    // Update the title whenever the query changes
    states.query.resource.values$()
      .takeUntil(scopeDestroyed$($scope))
      .subscribe((query) => {
        updateTitle(query);
      });

    // Update the checksum and url query params whenever a new query is loaded
    states.query.resource
      .values$()
      .takeUntil(scopeDestroyed$($scope))
      .distinctUntilChanged((query, formerQuery) => query.id === formerQuery.id)
      .withLatestFrom(wpTablePagination.state.values$())
      .subscribe(([query, pagination]) => {
        wpListChecksumService.setToQuery(query, pagination);
      });

    states.query.context.fireOnStateChange(wpTablePagination.state, 'Query loaded')
      .values$()
      .withLatestFrom(states.query.resource.values$())
      .takeUntil(scopeDestroyed$($scope))
      .subscribe(([pagination, query]) => {
        if (wpListChecksumService.isQueryOutdated(query, pagination)) {
          wpListChecksumService.update(query, pagination);

          updateResultsVisibly();
        }
      });

    setupChangeObserver(wpTableFilters, true);
    setupChangeObserver(wpTableGroupBy);
    setupChangeObserver(wpTableSortBy);
    setupChangeObserver(wpTableSum);
    setupChangeObserver(wpTableTimeline);
    setupChangeObserver(wpTableHierarchies);
    setupChangeObserver(wpTableColumns);
  }


}

/////////////////////////
// convert below to above
/////////////////////////

function WorkPackagesListController() {


  function setupChangeObserver(service:WorkPackageQueryStateService, firstPage:boolean = false) {
    const queryState = states.query.resource;

    states.query.context.fireOnStateChange(service.state, 'Query loaded')
      .values$()
      .takeUntil(scopeDestroyed$($scope))
      .filter(() => queryState.hasValue() && service.hasChanged(queryState.value!))
      .subscribe(() => {
        const newQuery = queryState.value!;
        const triggerUpdate = service.applyToQuery(newQuery);
        states.query.resource.putValue(newQuery);

        // Update the current checksum
        wpListChecksumService.updateIfDifferent(newQuery, wpTablePagination.current);

        // Update the page, if the change requires it
        if (triggerUpdate) {
          wpTableRefresh.request('Query updated by user', true, firstPage);
        }
      });
  }

  /**
   * Setup the listener for members of the table to request a refresh of the entire table
   * through the refresh service.
   */
  function setupRefreshObserver() {
    wpTableRefresh.state
      .values$('Refresh listener in wp-list.controller')
      .takeUntil(scopeDestroyed$($scope))
      .auditTime(20)
      .subscribe(([refreshVisibly, firstPage]) => {
        if (refreshVisibly) {
          debugLog('Refreshing work package results visibly.');
          updateResultsVisibly(firstPage);
        } else {
          debugLog('Refreshing work package results in the background.');
          updateResults();
        }
      });
  }

  function loadQuery() {
    wpListChecksumService.clear();
    loadingIndicator.table.promise =
      wpListService.fromQueryParams($state.params, $scope.projectIdentifier).then(() => {
        return states.globalTable.rendered.valuesPromise();
      });
  }

  $scope.setAnchorToNextElement = function() {
    // Skip to next when visible, otherwise skip to previous
    const selectors = '#pagination--next-link, #pagination--prev-link, #pagination-empty-text';
    const visibleLink = jQuery(selectors)
      .not(':hidden')
      .first();

    if (visibleLink.length) {
      visibleLink.focus();
    }
  };

  function updateResults() {
    return wpListService.reloadCurrentResultsList();
  }

  function updateToFirstResultsPage() {
    return wpListService.loadCurrentResultsListFirstPage();
  }

  function updateResultsVisibly(firstPage:boolean = false) {
    if (firstPage) {
      loadingIndicator.table.promise = updateToFirstResultsPage();
    } else {
      loadingIndicator.table.promise = updateResults();
    }
  }

  $scope.allowed = function(model:string, permission:string) {
    return AuthorisationService.can(model, permission);
  };

  function updateTitle(query:QueryResource) {
    if (query.id) {
      $scope.selectedTitle = query.name;
    } else {
      $scope.selectedTitle = I18n.t('js.label_work_package_plural');
    }
  }

  $scope.$watchCollection(
    () => {
      return {
        query_id: $state.params['query_id'],
        query_props: $state.params['query_props']
      };
    },
    (params:any) => {
      let newChecksum = params.query_props;
      let newId = params.query_id && parseInt(params.query_id);

      wpListChecksumService.executeIfOutdated(newId,
        newChecksum,
        loadQuery);
    });
}

angular
  .module('openproject.workPackages.controllers')
  .controller('WorkPackagesListController', WorkPackagesListController);