package com.backendforge.telestore.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.ViewList
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.backendforge.telestore.core.SortBy

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SortViewSheet(
    sortBy: SortBy,
    ascending: Boolean,
    isGrid: Boolean,
    onSortChange: (SortBy, Boolean) -> Unit,
    onViewModeChange: (Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
        ) {
            Text(
                text = "Sort & view",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Sort by",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                FilterChip(
                    selected = sortBy == SortBy.NAME,
                    onClick = { onSortChange(SortBy.NAME, ascending) },
                    label = { Text("Name") },
                )
                FilterChip(
                    selected = sortBy == SortBy.DATE,
                    onClick = { onSortChange(SortBy.DATE, ascending) },
                    label = { Text("Date") },
                )
                FilterChip(
                    selected = sortBy == SortBy.SIZE,
                    onClick = { onSortChange(SortBy.SIZE, ascending) },
                    label = { Text("Size") },
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Order",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                FilterChip(
                    selected = ascending,
                    onClick = { onSortChange(sortBy, true) },
                    label = { Text(if (sortBy == SortBy.NAME) "A to Z" else if (sortBy == SortBy.DATE) "Oldest first" else "Smallest first") },
                    leadingIcon = { Icon(Icons.AutoMirrored.Filled.Sort, contentDescription = null) },
                )
                FilterChip(
                    selected = !ascending,
                    onClick = { onSortChange(sortBy, false) },
                    label = { Text(if (sortBy == SortBy.NAME) "Z to A" else if (sortBy == SortBy.DATE) "Newest first" else "Largest first") },
                    leadingIcon = { Icon(Icons.AutoMirrored.Filled.Sort, contentDescription = null) },
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "View",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                FilterChip(
                    selected = !isGrid,
                    onClick = { onViewModeChange(false) },
                    label = { Text("List") },
                    leadingIcon = { Icon(Icons.Default.ViewList, contentDescription = null) },
                )
                FilterChip(
                    selected = isGrid,
                    onClick = { onViewModeChange(true) },
                    label = { Text("Grid") },
                    leadingIcon = { Icon(Icons.Default.GridView, contentDescription = null) },
                )
            }
        }
    }
}
